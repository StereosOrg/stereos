//! glTF/glb export with KHR_gaussian_splatting extension
//!
//! Exports Gaussian splat data to glTF 2.0 format using:
//! - POSITION: Gaussian centers (VEC3 f32 or i16 quantized)
//! - COLOR_0: RGBA from SH DC + opacity (VEC4 u8 or f32)
//! - _ROTATION: Quaternion (VEC4 f32)
//! - _SCALE: Anisotropic scale (VEC3 f32)

use crate::{ExportConfig, GaussianCloud, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use bytemuck::cast_slice;
use gltf_json as json;
use gltf_json::validation::{Checked, USize64};
use std::collections::BTreeMap;

#[cfg(feature = "meshopt")]
use meshopt_rs::vertex::{buffer::encode_vertex_buffer, VertexEncodingVersion};

/// SH coefficient for converting DC to color
/// This is 1 / (2 * sqrt(pi))
const SH_C0: f32 = 0.282_094_79;

/// Statistics about compression performance
#[derive(Clone, Debug, Default)]
pub struct CompressionStats {
    /// Number of buffer views that were compressed
    pub compressed_count: usize,
    /// Number of buffer views that couldn't be compressed (stride incompatible, etc.)
    pub skipped_count: usize,
    /// Total original size of all buffer views in bytes
    pub original_size: usize,
    /// Total compressed size of all buffer views in bytes
    pub compressed_size: usize,
    /// Per-buffer-view compression details
    pub details: Vec<BufferViewCompressionInfo>,
}

/// Information about compression for a single buffer view
#[derive(Clone, Debug)]
pub struct BufferViewCompressionInfo {
    /// Attribute name (e.g., "POSITION", "COLOR_0", etc.)
    pub attribute: String,
    /// Original size in bytes
    pub original_size: usize,
    /// Compressed size in bytes (0 if not compressed)
    pub compressed_size: usize,
    /// Compression ratio (original / compressed), 1.0 if not compressed
    pub ratio: f64,
}

/// Result of a glTF export with detailed statistics
pub struct ExportResult {
    /// The exported glTF/glb data
    pub data: Vec<u8>,
    /// Compression statistics (if meshopt was enabled)
    pub compression_stats: Option<CompressionStats>,
}

/// Convert SH DC coefficients and opacity to RGBA
#[inline]
fn sh_to_rgba(sh: &[f32; 48], opacity: f32) -> [f32; 4] {
    [
        (sh[0] * SH_C0 + 0.5).clamp(0.0, 1.0),
        (sh[1] * SH_C0 + 0.5).clamp(0.0, 1.0),
        (sh[2] * SH_C0 + 0.5).clamp(0.0, 1.0),
        opacity,
    ]
}

/// Export GaussianCloud to binary GLB format with compression statistics
pub fn export_glb_with_stats(cloud: &GaussianCloud, config: &ExportConfig) -> Result<ExportResult> {
    let (root, buffer_data, compression_stats) = build_gltf(cloud, config)?;

    let json_string = serde_json::to_string(&root)?;
    let json_bytes = json_string.as_bytes();

    // Pad JSON to 4-byte alignment (with spaces)
    let json_padding = (4 - (json_bytes.len() % 4)) % 4;
    let json_length = json_bytes.len() + json_padding;

    // Pad buffer to 4-byte alignment (with zeros)
    let bin_padding = (4 - (buffer_data.len() % 4)) % 4;
    let bin_length = buffer_data.len() + bin_padding;

    // GLB structure:
    // - 12 bytes header (magic + version + length)
    // - 8 bytes JSON chunk header (length + type)
    // - JSON data + padding
    // - 8 bytes BIN chunk header (length + type)
    // - BIN data + padding
    let total_length = 12 + 8 + json_length + 8 + bin_length;

    let mut output = Vec::with_capacity(total_length);

    // GLB Header
    output.extend_from_slice(b"glTF"); // magic
    output.extend_from_slice(&2u32.to_le_bytes()); // version
    output.extend_from_slice(&(total_length as u32).to_le_bytes()); // total length

    // JSON chunk
    output.extend_from_slice(&(json_length as u32).to_le_bytes()); // chunk length
    output.extend_from_slice(&0x4E4F534Au32.to_le_bytes()); // chunk type "JSON"
    output.extend_from_slice(json_bytes);
    output.extend(std::iter::repeat(0x20u8).take(json_padding)); // space padding

    // BIN chunk
    output.extend_from_slice(&(bin_length as u32).to_le_bytes()); // chunk length
    output.extend_from_slice(&0x004E4942u32.to_le_bytes()); // chunk type "BIN\0"
    output.extend_from_slice(&buffer_data);
    output.extend(std::iter::repeat(0u8).take(bin_padding)); // zero padding

    Ok(ExportResult {
        data: output,
        compression_stats,
    })
}

/// Export GaussianCloud to binary GLB format (backward compatible)
pub fn export_glb(cloud: &GaussianCloud, config: &ExportConfig) -> Result<Vec<u8>> {
    export_glb_with_stats(cloud, config).map(|r| r.data)
}

/// Export GaussianCloud to JSON glTF with embedded base64 buffer
pub fn export_gltf_embedded(cloud: &GaussianCloud, config: &ExportConfig) -> Result<Vec<u8>> {
    let (mut root, buffer_data, _) = build_gltf(cloud, config)?;

    // Embed buffer as base64 data URI
    let b64 = BASE64.encode(&buffer_data);
    root.buffers[0].uri = Some(format!("data:application/octet-stream;base64,{}", b64));

    let json_string = serde_json::to_string_pretty(&root)?;
    Ok(json_string.into_bytes())
}

/// Export GaussianCloud to JSON glTF with embedded base64 buffer and stats
pub fn export_gltf_embedded_with_stats(
    cloud: &GaussianCloud,
    config: &ExportConfig,
) -> Result<ExportResult> {
    let (mut root, buffer_data, compression_stats) = build_gltf(cloud, config)?;

    // Embed buffer as base64 data URI
    let b64 = BASE64.encode(&buffer_data);
    root.buffers[0].uri = Some(format!("data:application/octet-stream;base64,{}", b64));

    let json_string = serde_json::to_string_pretty(&root)?;
    Ok(ExportResult {
        data: json_string.into_bytes(),
        compression_stats,
    })
}

/// Compression result for a single buffer view
#[cfg(feature = "meshopt")]
struct VertexCompressionResult {
    data: Vec<u8>,
    original_size: usize,
    compressed_size: usize,
}

/// Compress vertex buffer data using meshopt (if feature enabled)
#[cfg(feature = "meshopt")]
fn compress_vertex_buffer(
    data: &[u8],
    vertex_stride: usize,
    vertex_count: usize,
) -> Option<VertexCompressionResult> {
    use meshopt_rs::vertex::buffer::encode_vertex_buffer_bound;

    if vertex_stride == 0 || vertex_count == 0 || data.is_empty() {
        return None;
    }

    // Check that data length matches expected size
    if data.len() != vertex_count * vertex_stride {
        return None;
    }

    // meshopt requires stride to be a multiple of 4
    // For non-multiple-of-4 strides, we pad the data temporarily
    let padded_stride = if vertex_stride % 4 != 0 {
        vertex_stride + (4 - vertex_stride % 4)
    } else {
        vertex_stride
    };

    // If we need padding, create a padded buffer
    let padded_data: Vec<u8> = if padded_stride != vertex_stride {
        let mut padded = Vec::with_capacity(vertex_count * padded_stride);
        for i in 0..vertex_count {
            padded.extend_from_slice(&data[i * vertex_stride..(i + 1) * vertex_stride]);
            // Add padding bytes
            padded.extend(std::iter::repeat(0u8).take(padded_stride - vertex_stride));
        }
        padded
    } else {
        data.to_vec()
    };

    // Calculate bound and allocate output buffer
    let bound = encode_vertex_buffer_bound(vertex_count, padded_stride);
    let mut output = vec![0u8; bound];

    // Use a generic approach: treat vertices as arrays of u32 values
    // This works because padded_stride is always a multiple of 4
    let u32_count = padded_stride / 4;
    let _vertices: &[[u32; 1]] = bytemuck::cast_slice(&padded_data);

    // We need to reinterpret the slice as a flat array of "vertex-sized" chunks
    // meshopt expects contiguous vertex data, so we'll use a different approach
    // Encode as if it's an array of the largest supported fixed-size array
    let result = match u32_count {
        1 => {
            // 4 bytes - treat as [u32; 1]
            let vertices: &[[u32; 1]] = bytemuck::cast_slice(&padded_data);
            encode_vertex_buffer(&mut output, vertices, VertexEncodingVersion::V0)
        }
        2 => {
            // 8 bytes - treat as [u32; 2]
            let vertices: &[[u32; 2]] = bytemuck::cast_slice(&padded_data);
            encode_vertex_buffer(&mut output, vertices, VertexEncodingVersion::V0)
        }
        3 => {
            // 12 bytes - treat as [f32; 3]
            let vertices: &[[f32; 3]] = bytemuck::cast_slice(&padded_data);
            encode_vertex_buffer(&mut output, vertices, VertexEncodingVersion::V0)
        }
        4 => {
            // 16 bytes - treat as [f32; 4]
            let vertices: &[[f32; 4]] = bytemuck::cast_slice(&padded_data);
            encode_vertex_buffer(&mut output, vertices, VertexEncodingVersion::V0)
        }
        _ => {
            // For larger strides, we could use multiple passes or skip compression
            // For now, skip compression for very large strides
            return None;
        }
    };

    result.and_then(|bytes_written| {
        if bytes_written < data.len() {
            output.truncate(bytes_written);
            Some(VertexCompressionResult {
                data: output,
                original_size: data.len(),
                compressed_size: bytes_written,
            })
        } else {
            None // Compression didn't help
        }
    })
}

#[cfg(not(feature = "meshopt"))]
fn compress_vertex_buffer(_data: &[u8], _vertex_stride: usize, _vertex_count: usize) -> Option<()> {
    None
}

/// Build the glTF JSON structure and binary buffer
fn build_gltf(
    cloud: &GaussianCloud,
    config: &ExportConfig,
) -> Result<(json::Root, Vec<u8>, Option<CompressionStats>)> {
    let mut buffer_data = Vec::new();
    let mut accessors = Vec::new();
    let mut buffer_views = Vec::new();
    let count = cloud.count as u64;
    let use_meshopt = config.meshopt_compression;

    // Track compression statistics
    let mut compression_stats = CompressionStats::default();

    // Helper closure to add an accessor and buffer view
    // Returns accessor_idx
    let mut add_accessor = |data: &[u8],
                            component_type: json::accessor::ComponentType,
                            type_: json::accessor::Type,
                            min: Option<serde_json::Value>,
                            max: Option<serde_json::Value>,
                            normalized: bool,
                            vertex_stride: usize,
                            attribute_name: &str|
     -> u32 {
        // Align to 4 bytes
        let padding = (4 - (buffer_data.len() % 4)) % 4;
        buffer_data.extend(std::iter::repeat(0u8).take(padding));
        let offset = buffer_data.len() as u64;

        // Try to compress if meshopt is enabled
        let (final_data, used_meshopt, original_size, compressed_size) =
            if use_meshopt && vertex_stride > 0 {
                #[cfg(feature = "meshopt")]
                {
                    if let Some(result) =
                        compress_vertex_buffer(data, vertex_stride, count as usize)
                    {
                        (
                            result.data,
                            true,
                            result.original_size,
                            result.compressed_size,
                        )
                    } else {
                        (data.to_vec(), false, data.len(), data.len())
                    }
                }
                #[cfg(not(feature = "meshopt"))]
                {
                    let _ = (data, vertex_stride, count);
                    (data.to_vec(), false, data.len(), data.len())
                }
            } else {
                (data.to_vec(), false, data.len(), data.len())
            };

        // Track statistics
        if use_meshopt {
            if used_meshopt {
                compression_stats.compressed_count += 1;
                compression_stats.original_size += original_size;
                compression_stats.compressed_size += compressed_size;
            } else if vertex_stride > 0 {
                compression_stats.skipped_count += 1;
                compression_stats.original_size += original_size;
                compression_stats.compressed_size += original_size; // No compression
            }
            compression_stats.details.push(BufferViewCompressionInfo {
                attribute: attribute_name.to_string(),
                original_size,
                compressed_size: if used_meshopt { compressed_size } else { 0 },
                ratio: if used_meshopt {
                    original_size as f64 / compressed_size as f64
                } else {
                    1.0
                },
            });
        }

        buffer_data.extend_from_slice(&final_data);

        let view_idx = buffer_views.len() as u32;

        // Build meshopt extension if compression was used
        let extensions = if used_meshopt {
            use serde_json::Map;
            
            // EXT_meshopt_compression extension for buffer view
            // See: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md
            let meshopt_ext = serde_json::json!({
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": final_data.len(),
                "byteStride": vertex_stride,
                "count": count,
                "mode": "ATTRIBUTES"
            });
            
            let mut others = Map::new();
            others.insert("EXT_meshopt_compression".to_string(), meshopt_ext);
            
            Some(json::extensions::buffer::View { others })
        } else {
            None
        };

        buffer_views.push(json::buffer::View {
            buffer: json::Index::new(0),
            byte_offset: Some(USize64::from(offset)),
            byte_length: USize64::from(final_data.len() as u64),
            byte_stride: None,
            target: None,
            extensions,
            extras: Default::default(),
            name: Some(format!("{}_view", attribute_name)),
        });

        let accessor_idx = accessors.len() as u32;
        accessors.push(json::Accessor {
            buffer_view: Some(json::Index::new(view_idx)),
            byte_offset: None,
            component_type: Checked::Valid(json::accessor::GenericComponentType(component_type)),
            count: USize64::from(count),
            type_: Checked::Valid(type_),
            min,
            max,
            normalized,
            sparse: None,
            extensions: None,
            extras: Default::default(),
            name: Some(attribute_name.to_string()),
        });

        accessor_idx
    };

    // POSITION - either f32 or quantized i16
    let (min_p, max_p) = compute_bounds(&cloud.positions);
    let pos_idx = if config.quantize_positions {
        // Quantize to normalized i16 [-32767, 32767]
        // We need to store the actual min/max for proper decoding
        let positions_i16: Vec<[i16; 3]> = cloud
            .positions
            .iter()
            .map(|p| {
                // Normalize each component to [-1, 1] based on bounds, then scale to i16 range
                let normalize = |val: f32, min: f32, max: f32| -> i16 {
                    if (max - min).abs() < f32::EPSILON {
                        0
                    } else {
                        let normalized = (val - min) / (max - min) * 2.0 - 1.0; // -1 to 1
                        (normalized * 32767.0).clamp(-32767.0, 32767.0) as i16
                    }
                };
                [
                    normalize(p.x, min_p.x, max_p.x),
                    normalize(p.y, min_p.y, max_p.y),
                    normalize(p.z, min_p.z, max_p.z),
                ]
            })
            .collect();

        add_accessor(
            cast_slice(&positions_i16),
            json::accessor::ComponentType::I16,
            json::accessor::Type::Vec3,
            Some(serde_json::json!([min_p.x, min_p.y, min_p.z])),
            Some(serde_json::json!([max_p.x, max_p.y, max_p.z])),
            true, // normalized - loader will denormalize using min/max
            6,    // i16 x 3 = 6 bytes stride (will be padded to 8 for meshopt)
            "POSITION",
        )
    } else {
        let positions: Vec<[f32; 3]> = cloud.positions.iter().map(|p| p.to_array()).collect();
        add_accessor(
            cast_slice(&positions),
            json::accessor::ComponentType::F32,
            json::accessor::Type::Vec3,
            Some(serde_json::json!([min_p.x, min_p.y, min_p.z])),
            Some(serde_json::json!([max_p.x, max_p.y, max_p.z])),
            false,
            12, // f32 x 3 = 12 bytes stride
            "POSITION",
        )
    };

    // COLOR_0 (VEC4)
    let colors: Vec<[f32; 4]> = cloud
        .sh_coeffs
        .iter()
        .zip(&cloud.opacities)
        .map(|(sh, &o)| sh_to_rgba(sh, o))
        .collect();

    let color_idx = if config.quantize_colors {
        // Quantize to u8 (normalized)
        let colors_u8: Vec<[u8; 4]> = colors
            .iter()
            .map(|c| {
                [
                    (c[0] * 255.0).round() as u8,
                    (c[1] * 255.0).round() as u8,
                    (c[2] * 255.0).round() as u8,
                    (c[3] * 255.0).round() as u8,
                ]
            })
            .collect();
        add_accessor(
            cast_slice(&colors_u8),
            json::accessor::ComponentType::U8,
            json::accessor::Type::Vec4,
            None,
            None,
            true, // normalized
            4,    // u8 x 4 = 4 bytes stride
            "COLOR_0",
        )
    } else {
        add_accessor(
            cast_slice(&colors),
            json::accessor::ComponentType::F32,
            json::accessor::Type::Vec4,
            None,
            None,
            false,
            16, // f32 x 4 = 16 bytes stride
            "COLOR_0",
        )
    };

    // _ROTATION (VEC4 f32) - quaternion as [x, y, z, w]
    let rotations: Vec<[f32; 4]> = cloud
        .rotations
        .iter()
        .map(|q| [q.x, q.y, q.z, q.w])
        .collect();
    let rot_idx = add_accessor(
        cast_slice(&rotations),
        json::accessor::ComponentType::F32,
        json::accessor::Type::Vec4,
        None,
        None,
        false,
        16, // f32 x 4 = 16 bytes stride
        "_ROTATION",
    );

    // _SCALE (VEC3 f32)
    let scales: Vec<[f32; 3]> = cloud.scales.iter().map(|s| s.to_array()).collect();
    let scale_idx = add_accessor(
        cast_slice(&scales),
        json::accessor::ComponentType::F32,
        json::accessor::Type::Vec3,
        None,
        None,
        false,
        12, // f32 x 3 = 12 bytes stride
        "_SCALE",
    );

    // _SH_COEFFICIENTS (optional - full spherical harmonics for view-dependent rendering)
    // 48 floats per splat: 3 DC + 45 higher-order terms
    // We store this as 12 x VEC4 accessors or as a flat buffer
    // For simplicity, we'll use a single accessor with a custom type via extras
    let sh_idx = if config.export_full_sh {
        // Flatten SH coefficients: 48 floats per splat
        let sh_flat: Vec<f32> = cloud.sh_coeffs.iter().flat_map(|sh| sh.iter().copied()).collect();

        // Store as scalar array with byte_stride to indicate structure
        // Each splat has 48 floats = 192 bytes
        let data = cast_slice::<f32, u8>(&sh_flat);

        // Align to 4 bytes
        let padding = (4 - (buffer_data.len() % 4)) % 4;
        buffer_data.extend(std::iter::repeat(0u8).take(padding));
        let offset = buffer_data.len() as u64;
        buffer_data.extend_from_slice(data);

        let view_idx = buffer_views.len() as u32;
        buffer_views.push(json::buffer::View {
            buffer: json::Index::new(0),
            byte_offset: Some(USize64::from(offset)),
            byte_length: USize64::from(data.len() as u64),
            byte_stride: Some(json::buffer::Stride(192)), // 48 floats * 4 bytes
            target: None,
            extensions: None,
            extras: Default::default(),
            name: Some("_SH_COEFFICIENTS_view".into()),
        });

        // We'll create multiple accessors for the SH data in groups of 4 (VEC4)
        // This is more compatible with glTF loaders
        // 48 floats = 12 VEC4 accessors
        let mut sh_accessor_indices = Vec::new();
        for i in 0..12 {
            let accessor_idx = accessors.len() as u32;
            accessors.push(json::Accessor {
                buffer_view: Some(json::Index::new(view_idx)),
                byte_offset: Some(USize64::from((i * 16) as u64)), // 4 floats * 4 bytes = 16
                component_type: Checked::Valid(json::accessor::GenericComponentType(
                    json::accessor::ComponentType::F32,
                )),
                count: USize64::from(count),
                type_: Checked::Valid(json::accessor::Type::Vec4),
                min: None,
                max: None,
                normalized: false,
                sparse: None,
                extensions: None,
                extras: Default::default(),
                name: Some(format!("_SH_COEFFICIENTS_{}", i)),
            });
            sh_accessor_indices.push(accessor_idx);
        }
        Some(sh_accessor_indices)
    } else {
        None
    };

    // Build primitive attributes map
    let mut attributes = BTreeMap::new();
    attributes.insert(
        Checked::Valid(json::mesh::Semantic::Positions),
        json::Index::new(pos_idx),
    );
    attributes.insert(
        Checked::Valid(json::mesh::Semantic::Colors(0)),
        json::Index::new(color_idx),
    );
    // Custom attributes for Gaussian splatting
    attributes.insert(
        Checked::Valid(json::mesh::Semantic::Extras("_ROTATION".into())),
        json::Index::new(rot_idx),
    );
    attributes.insert(
        Checked::Valid(json::mesh::Semantic::Extras("_SCALE".into())),
        json::Index::new(scale_idx),
    );

    // Add SH coefficient attributes if full SH export is enabled
    if let Some(ref sh_indices) = sh_idx {
        for (i, &idx) in sh_indices.iter().enumerate() {
            attributes.insert(
                Checked::Valid(json::mesh::Semantic::Extras(format!("_SH_COEFFICIENTS_{}", i))),
                json::Index::new(idx),
            );
        }
    }

    // Create primitive with KHR_gaussian_splatting extension marker
    // Note: The extension object is empty per spec - the presence indicates splat data
    let primitive = json::mesh::Primitive {
        attributes,
        indices: None,
        material: None,
        mode: Checked::Valid(json::mesh::Mode::Points),
        targets: None,
        extensions: None, // Extension handled at root level for now
        extras: Default::default(),
    };

    // Determine if we actually have meshopt compression
    let has_meshopt_compression = compression_stats.compressed_count > 0;

    // Build the complete glTF document
    let root = json::Root {
        accessors,
        buffers: vec![json::Buffer {
            byte_length: USize64::from(buffer_data.len() as u64),
            uri: None, // Will be set for embedded format
            extensions: None,
            extras: Default::default(),
            name: Some("main_buffer".into()),
        }],
        buffer_views,
        meshes: vec![json::Mesh {
            primitives: vec![primitive],
            weights: None,
            extensions: None,
            extras: Default::default(),
            name: Some("gaussian_splats".into()),
        }],
        nodes: vec![json::Node {
            mesh: Some(json::Index::new(0)),
            camera: None,
            children: None,
            skin: None,
            matrix: None,
            rotation: None,
            scale: None,
            translation: None,
            weights: None,
            extensions: None,
            extras: Default::default(),
            name: Some("GaussianSplats".into()),
        }],
        scenes: vec![json::Scene {
            nodes: vec![json::Index::new(0)],
            extensions: None,
            extras: Default::default(),
            name: Some("Scene".into()),
        }],
        scene: Some(json::Index::new(0)),
        extensions_used: {
            let mut exts = vec!["KHR_gaussian_splatting".into()];
            if config.quantize_positions {
                exts.push("KHR_mesh_quantization".into());
            }
            if has_meshopt_compression {
                exts.push("EXT_meshopt_compression".into());
            }
            exts
        },
        extensions_required: vec![], // Not required for fallback to point cloud
        asset: json::Asset {
            version: "2.0".into(),
            generator: Some("stereos".into()),
            copyright: None,
            min_version: None,
            extensions: None,
            extras: Default::default(),
        },
        animations: Vec::new(),
        cameras: Vec::new(),
        images: Vec::new(),
        materials: Vec::new(),
        samplers: Vec::new(),
        skins: Vec::new(),
        textures: Vec::new(),
        extensions: None,
        extras: Default::default(),
    };

    let stats = if use_meshopt {
        Some(compression_stats)
    } else {
        None
    };

    Ok((root, buffer_data, stats))
}

/// Compute min/max bounds for positions
fn compute_bounds(positions: &[glam::Vec3]) -> (glam::Vec3, glam::Vec3) {
    if positions.is_empty() {
        return (glam::Vec3::ZERO, glam::Vec3::ZERO);
    }

    positions.iter().fold(
        (glam::Vec3::splat(f32::MAX), glam::Vec3::splat(f32::MIN)),
        |(min, max), p| (min.min(*p), max.max(*p)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::{Quat, Vec3};

    fn create_test_cloud(count: usize) -> GaussianCloud {
        // Create varied data for better compression testing
        let mut positions = Vec::with_capacity(count);
        let mut opacities = Vec::with_capacity(count);
        let mut scales = Vec::with_capacity(count);
        let mut rotations = Vec::with_capacity(count);
        let mut sh_coeffs = Vec::with_capacity(count);

        for i in 0..count {
            // Vary positions for bounds testing
            let t = i as f32 / count.max(1) as f32;
            positions.push(Vec3::new(
                (t * 10.0).sin(),
                (t * 10.0).cos(),
                t * 5.0 - 2.5,
            ));
            opacities.push(0.5 + t * 0.5);
            scales.push(Vec3::new(0.1 + t * 0.05, 0.1, 0.1 - t * 0.05));
            rotations.push(Quat::from_xyzw(0.0, 0.0, t.sin(), t.cos()));
            // Vary SH coefficients
            let mut sh = [0.5f32; 48];
            sh[0] = t; // R
            sh[1] = 1.0 - t; // G
            sh[2] = (t * 2.0).min(1.0); // B
            sh_coeffs.push(sh);
        }

        GaussianCloud {
            count,
            positions,
            opacities,
            scales,
            rotations,
            sh_coeffs,
        }
    }

    fn create_minimal_test_cloud(count: usize) -> GaussianCloud {
        GaussianCloud {
            count,
            positions: vec![Vec3::new(0.0, 1.0, 2.0); count],
            opacities: vec![0.5; count],
            scales: vec![Vec3::new(0.1, 0.1, 0.1); count],
            rotations: vec![Quat::IDENTITY; count],
            sh_coeffs: vec![[0.5; 48]; count],
        }
    }

    #[test]
    fn test_sh_to_rgba() {
        let sh = [0.0f32; 48];
        let rgba = sh_to_rgba(&sh, 1.0);
        // With sh=0, color should be ~0.5 (the offset)
        assert!((rgba[0] - 0.5).abs() < 0.01);
        assert!((rgba[1] - 0.5).abs() < 0.01);
        assert!((rgba[2] - 0.5).abs() < 0.01);
        assert!((rgba[3] - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_sh_to_rgba_with_values() {
        let mut sh = [0.0f32; 48];
        sh[0] = 1.0; // Red DC coefficient
        sh[1] = 0.5; // Green DC coefficient
        sh[2] = -0.5; // Blue DC coefficient

        let rgba = sh_to_rgba(&sh, 0.8);

        // R = 1.0 * SH_C0 + 0.5 = 0.282 + 0.5 = 0.782
        assert!((rgba[0] - (1.0 * SH_C0 + 0.5)).abs() < 0.01);
        // G = 0.5 * SH_C0 + 0.5 = 0.141 + 0.5 = 0.641
        assert!((rgba[1] - (0.5 * SH_C0 + 0.5)).abs() < 0.01);
        // B = -0.5 * SH_C0 + 0.5 = -0.141 + 0.5 = 0.359
        assert!((rgba[2] - (-0.5 * SH_C0 + 0.5)).abs() < 0.01);
        // Opacity unchanged
        assert!((rgba[3] - 0.8).abs() < 0.01);
    }

    #[test]
    fn test_export_glb_structure() {
        let cloud = create_minimal_test_cloud(10);
        let config = ExportConfig::default();
        let glb = export_glb(&cloud, &config).unwrap();

        // Check GLB magic
        assert_eq!(&glb[0..4], b"glTF");
        // Check version
        assert_eq!(u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]), 2);

        // Check total length matches
        let total_length = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total_length, glb.len());
    }

    #[test]
    fn test_export_glb_with_stats_structure() {
        let cloud = create_test_cloud(10);
        let config = ExportConfig::default();
        let result = export_glb_with_stats(&cloud, &config).unwrap();

        // Verify data is valid GLB
        assert_eq!(&result.data[0..4], b"glTF");

        // Without meshopt, stats should be None
        assert!(result.compression_stats.is_none());
    }

    #[test]
    fn test_export_gltf_embedded() {
        let cloud = create_minimal_test_cloud(5);
        let config = ExportConfig::default();
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        assert!(gltf_str.contains("\"version\": \"2.0\""));
        assert!(gltf_str.contains("KHR_gaussian_splatting"));
        assert!(gltf_str.contains("data:application/octet-stream;base64," ));

        // Verify all required attributes are present
        assert!(gltf_str.contains("POSITION"));
        assert!(gltf_str.contains("COLOR_0"));
        assert!(gltf_str.contains("_ROTATION"));
        assert!(gltf_str.contains("_SCALE"));
    }

    #[test]
    fn test_compute_bounds() {
        let positions = vec![
            Vec3::new(-1.0, 0.0, 5.0),
            Vec3::new(2.0, -3.0, 1.0),
            Vec3::new(0.0, 4.0, 2.0),
        ];
        let (min, max) = compute_bounds(&positions);
        assert_eq!(min, Vec3::new(-1.0, -3.0, 1.0));
        assert_eq!(max, Vec3::new(2.0, 4.0, 5.0));
    }

    #[test]
    fn test_compute_bounds_empty() {
        let positions: Vec<Vec3> = vec![];
        let (min, max) = compute_bounds(&positions);
        assert_eq!(min, Vec3::ZERO);
        assert_eq!(max, Vec3::ZERO);
    }

    #[test]
    fn test_compute_bounds_single_point() {
        let positions = vec![Vec3::new(1.0, 2.0, 3.0)];
        let (min, max) = compute_bounds(&positions);
        assert_eq!(min, Vec3::new(1.0, 2.0, 3.0));
        assert_eq!(max, Vec3::new(1.0, 2.0, 3.0));
    }

    #[test]
    fn test_export_with_full_sh() {
        let cloud = create_minimal_test_cloud(5);
        let config = ExportConfig {
            export_full_sh: true,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should contain _SH_COEFFICIENTS attributes
        assert!(
            gltf_str.contains("_SH_COEFFICIENTS"),
            "Full SH export should include _SH_COEFFICIENTS attribute"
        );

        // Should contain all 12 VEC4 accessors
        for i in 0..12 {
            assert!(
                gltf_str.contains(&format!("_SH_COEFFICIENTS_{}", i)),
                "Full SH export should include _SH_COEFFICIENTS_{}",
                i
            );
        }
    }

    #[test]
    fn test_export_dc_only_no_sh_attribute() {
        let cloud = create_minimal_test_cloud(5);
        let config = ExportConfig {
            export_full_sh: false,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should NOT contain _SH_COEFFICIENTS
        assert!(
            !gltf_str.contains("_SH_COEFFICIENTS"),
            "DC-only export should not include _SH_COEFFICIENTS"
        );
    }

    #[test]
    fn test_export_with_position_quantization() {
        let cloud = create_test_cloud(5);
        let config = ExportConfig {
            quantize_positions: true,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should use KHR_mesh_quantization extension
        assert!(
            gltf_str.contains("KHR_mesh_quantization"),
            "Quantized positions should use KHR_mesh_quantization extension"
        );

        // Position accessor should use SHORT (5122) component type, not FLOAT (5126)
        // 5122 = SHORT in glTF spec
        assert!(
            gltf_str.contains("5122"),
            "Quantized positions should use SHORT component type"
        );

        // Should have min/max values for position accessor
        assert!(gltf_str.contains("\"min\""));
        assert!(gltf_str.contains("\"max\""));
    }

    #[test]
    fn test_export_without_position_quantization() {
        let cloud = create_minimal_test_cloud(5);
        let config = ExportConfig {
            quantize_positions: false,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should NOT use KHR_mesh_quantization
        assert!(
            !gltf_str.contains("KHR_mesh_quantization"),
            "Non-quantized positions should not use KHR_mesh_quantization"
        );

        // Should use FLOAT (5126) for positions
        assert!(
            gltf_str.contains("5126"),
            "Non-quantized positions should use FLOAT component type"
        );
    }

    #[test]
    fn test_full_sh_buffer_size_larger() {
        let cloud = create_test_cloud(10);

        let config_dc = ExportConfig {
            export_full_sh: false,
            ..Default::default()
        };
        let glb_dc = export_glb(&cloud, &config_dc).unwrap();

        let config_full = ExportConfig {
            export_full_sh: true,
            ..Default::default()
        };
        let glb_full = export_glb(&cloud, &config_full).unwrap();

        // Full SH should be significantly larger (48 floats vs just color)
        assert!(
            glb_full.len() > glb_dc.len() * 2,
            "Full SH export ({}) should be much larger than DC-only ({})",
            glb_full.len(),
            glb_dc.len()
        );
    }

    #[test]
    fn test_quantized_positions_smaller() {
        let cloud = create_test_cloud(100);

        let config_f32 = ExportConfig {
            quantize_positions: false,
            ..Default::default()
        };
        let glb_f32 = export_glb(&cloud, &config_f32).unwrap();

        let config_i16 = ExportConfig {
            quantize_positions: true,
            ..Default::default()
        };
        let glb_i16 = export_glb(&cloud, &config_i16).unwrap();

        // i16 positions should be smaller (6 bytes vs 12 bytes per position)
        assert!(
            glb_i16.len() < glb_f32.len(),
            "Quantized positions ({}) should be smaller than f32 ({})",
            glb_i16.len(),
            glb_f32.len()
        );
    }

    #[test]
    fn test_quantized_positions_bounds_accuracy() {
        let mut cloud = create_test_cloud(100);
        // Set specific bounds for verification
        cloud.positions[0] = Vec3::new(-10.0, -5.0, 0.0);
        cloud.positions[50] = Vec3::new(10.0, 5.0, 20.0);

        let config = ExportConfig {
            quantize_positions: true,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should have min/max that reflects actual bounds
        assert!(gltf_str.contains("-10"));
        assert!(gltf_str.contains("20"));
    }

    #[test]
    #[cfg(feature = "meshopt")]
    fn test_export_with_meshopt_compression() {
        let cloud = create_test_cloud(100);
        let config = ExportConfig {
            meshopt_compression: true,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should use EXT_meshopt_compression extension
        assert!(
            gltf_str.contains("EXT_meshopt_compression"),
            "Meshopt compression should use EXT_meshopt_compression extension"
        );

        // Should have meshopt buffer view extensions
        assert!(
            gltf_str.contains("EXT_meshopt_compression"),
            "Should have EXT_meshopt_compression in extensions"
        );
    }

    #[test]
    #[cfg(feature = "meshopt")]
    fn test_meshopt_compression_stats() {
        let cloud = create_test_cloud(500);

        let config = ExportConfig {
            meshopt_compression: true,
            quantize_positions: false, // Use f32 positions for better compression
            ..Default::default()
        };
        let result = export_glb_with_stats(&cloud, &config).unwrap();

        // Should have compression stats
        assert!(
            result.compression_stats.is_some(),
            "Should return compression stats when meshopt is enabled"
        );

        let stats = result.compression_stats.unwrap();
        assert!(
            stats.compressed_count > 0,
            "Should have compressed some buffer views"
        );
        assert!(
            !stats.details.is_empty(),
            "Should have detailed compression info"
        );

        // Check that we have details for expected attributes
        let has_position = stats.details.iter().any(|d| d.attribute == "POSITION");
        assert!(has_position, "Should have compression info for POSITION");
    }

    #[test]
    #[cfg(feature = "meshopt")]
    fn test_meshopt_compression_smaller() {
        let cloud = create_test_cloud(500);

        let config_uncompressed = ExportConfig {
            meshopt_compression: false,
            ..Default::default()
        };
        let glb_uncompressed = export_glb(&cloud, &config_uncompressed).unwrap();

        let config_compressed = ExportConfig {
            meshopt_compression: true,
            ..Default::default()
        };
        let glb_compressed = export_glb(&cloud, &config_compressed).unwrap();

        // Meshopt compression should result in smaller files
        assert!(
            glb_compressed.len() < glb_uncompressed.len(),
            "Meshopt compressed ({}) should be smaller than uncompressed ({})",
            glb_compressed.len(),
            glb_uncompressed.len()
        );
    }

    #[test]
    #[cfg(feature = "meshopt")]
    fn test_meshopt_compression_with_quantized_positions() {
        // Quantized positions have 6-byte stride which needs special handling
        let cloud = create_test_cloud(200);

        let config = ExportConfig {
            meshopt_compression: true,
            quantize_positions: true,
            ..Default::default()
        };
        let result = export_glb_with_stats(&cloud, &config).unwrap();

        // Should succeed and have stats
        assert!(result.compression_stats.is_some());

        // Data should be valid GLB
        assert_eq!(&result.data[0..4], b"glTF");
    }

    #[test]
    fn test_export_without_meshopt_no_extension() {
        let cloud = create_minimal_test_cloud(5);
        let config = ExportConfig {
            meshopt_compression: false,
            ..Default::default()
        };
        let gltf_bytes = export_gltf_embedded(&cloud, &config).unwrap();
        let gltf_str = String::from_utf8(gltf_bytes).unwrap();

        // Should NOT use EXT_meshopt_compression
        assert!(
            !gltf_str.contains("EXT_meshopt_compression"),
            "Uncompressed export should not include EXT_meshopt_compression"
        );
    }

    #[test]
    fn test_color_quantization() {
        let cloud = create_test_cloud(10);

        let config_quantized = ExportConfig {
            quantize_colors: true,
            ..Default::default()
        };
        let glb_quantized = export_glb(&cloud, &config_quantized).unwrap();

        let config_f32 = ExportConfig {
            quantize_colors: false,
            ..Default::default()
        };
        let glb_f32 = export_glb(&cloud, &config_f32).unwrap();

        // Quantized colors should be smaller (4 bytes vs 16 bytes per color)
        assert!(
            glb_quantized.len() < glb_f32.len(),
            "Quantized colors should produce smaller files"
        );
    }

    #[test]
    fn test_empty_cloud() {
        let cloud = GaussianCloud {
            count: 0,
            positions: vec![],
            opacities: vec![],
            scales: vec![],
            rotations: vec![],
            sh_coeffs: vec![],
        };

        let config = ExportConfig::default();
        let glb = export_glb(&cloud, &config).unwrap();

        // Should still produce valid GLB
        assert_eq!(&glb[0..4], b"glTF");
        assert_eq!(u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]), 2);
    }

    #[test]
    fn test_large_cloud() {
        // Test with a larger cloud to ensure performance is reasonable
        let cloud = create_test_cloud(10000);

        let config = ExportConfig {
            meshopt_compression: true,
            quantize_positions: true,
            quantize_colors: true,
            ..Default::default()
        };

        let result = export_glb_with_stats(&cloud, &config).unwrap();
        assert_eq!(&result.data[0..4], b"glTF");
    }

    #[test]
    fn test_compression_stats_structure() {
        let stats = CompressionStats {
            compressed_count: 3,
            skipped_count: 1,
            original_size: 1000,
            compressed_size: 600,
            details: vec![
                BufferViewCompressionInfo {
                    attribute: "POSITION".to_string(),
                    original_size: 400,
                    compressed_size: 200,
                    ratio: 2.0,
                },
                BufferViewCompressionInfo {
                    attribute: "COLOR_0".to_string(),
                    original_size: 200,
                    compressed_size: 150,
                    ratio: 1.33,
                },
            ],
        };

        assert_eq!(stats.compressed_count, 3);
        assert_eq!(stats.skipped_count, 1);
        assert_eq!(stats.original_size, 1000);
        assert_eq!(stats.compressed_size, 600);
        assert_eq!(stats.details.len(), 2);
        assert_eq!(stats.details[0].attribute, "POSITION");
        assert!((stats.details[0].ratio - 2.0).abs() < 0.01);
    }
}
