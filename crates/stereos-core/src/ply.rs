//! PLY file parser for 3D Gaussian Splatting files
//!
//! Supports both ASCII and binary (little-endian) PLY formats
//! with the standard 3DGS property layout.

use crate::{GaussianCloud, Result, SplatsError};
use glam::{Quat, Vec3};

/// Standard 3DGS PLY has 62 float properties = 248 bytes per vertex
const BYTES_PER_VERTEX: usize = 248;

/// Parse PLY file bytes into a GaussianCloud
pub fn parse(data: &[u8]) -> Result<GaussianCloud> {
    // PLY header is ASCII, so we can safely interpret as UTF-8 up to end_header
    let header_end = find_header_end(data)?;
    let header = std::str::from_utf8(&data[..header_end])
        .map_err(|_| SplatsError::Ply("Invalid UTF-8 in header".into()))?;

    let vertex_count = parse_vertex_count(header)?;
    let is_binary = header.contains("format binary_little_endian");

    // Body starts after "end_header\n"
    let body_start = header_end + "end_header".len() + 1;

    if is_binary {
        parse_binary(&data[body_start..], vertex_count)
    } else {
        let content = std::str::from_utf8(&data[body_start..])
            .map_err(|_| SplatsError::Ply("Invalid UTF-8 in ASCII PLY body".into()))?;
        parse_ascii(content, vertex_count)
    }
}

/// Find the byte offset of "end_header" in the data
fn find_header_end(data: &[u8]) -> Result<usize> {
    let needle = b"end_header";
    data.windows(needle.len())
        .position(|w| w == needle)
        .ok_or_else(|| SplatsError::Ply("No end_header found".into()))
}

/// Parse vertex count from PLY header
fn parse_vertex_count(header: &str) -> Result<usize> {
    for line in header.lines() {
        if line.starts_with("element vertex") {
            let count: usize = line
                .split_whitespace()
                .nth(2)
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| SplatsError::Ply("Invalid vertex count".into()))?;
            return Ok(count);
        }
    }
    Err(SplatsError::Ply("No vertex element found".into()))
}

/// Sigmoid activation for converting logit opacity to [0, 1]
#[inline]
fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// Parse binary little-endian PLY data
///
/// Standard 3DGS PLY binary layout (62 properties × 4 bytes = 248 bytes per vertex):
/// - bytes 0-11: x, y, z (position)
/// - bytes 12-23: nx, ny, nz (normals, unused)
/// - bytes 24-35: f_dc_0, f_dc_1, f_dc_2 (SH DC coefficients)
/// - bytes 36-215: f_rest_0..f_rest_44 (higher-order SH, 45 floats)
/// - bytes 216-219: opacity (logit)
/// - bytes 220-231: scale_0, scale_1, scale_2 (log scale)
/// - bytes 232-247: rot_0, rot_1, rot_2, rot_3 (quaternion, w first)
fn parse_binary(data: &[u8], count: usize) -> Result<GaussianCloud> {
    let expected_size = count * BYTES_PER_VERTEX;
    if data.len() < expected_size {
        return Err(SplatsError::Ply(format!(
            "Not enough data: expected {} bytes, got {}",
            expected_size,
            data.len()
        )));
    }

    let mut cloud = GaussianCloud::with_capacity(count);

    for i in 0..count {
        let offset = i * BYTES_PER_VERTEX;
        let vertex = &data[offset..offset + BYTES_PER_VERTEX];

        // Helper to read f32 at byte offset
        let read_f32 = |o: usize| -> f32 {
            f32::from_le_bytes([vertex[o], vertex[o + 1], vertex[o + 2], vertex[o + 3]])
        };

        // Position (bytes 0-11)
        let pos = Vec3::new(read_f32(0), read_f32(4), read_f32(8));

        // Skip normals (bytes 12-23)

        // SH coefficients (bytes 24-215)
        let mut sh = [0.0f32; 48];
        // DC (bytes 24-35)
        sh[0] = read_f32(24);
        sh[1] = read_f32(28);
        sh[2] = read_f32(32);
        // Rest (bytes 36-215, 45 floats)
        for j in 0..45 {
            sh[3 + j] = read_f32(36 + j * 4);
        }

        // Opacity (bytes 216-219) - stored as logit
        let opacity = sigmoid(read_f32(216));

        // Scale (bytes 220-231) - stored as log
        let scale = Vec3::new(
            read_f32(220).exp(),
            read_f32(224).exp(),
            read_f32(228).exp(),
        );

        // Rotation (bytes 232-247) - w, x, y, z order in file
        let rot = Quat::from_xyzw(
            read_f32(236), // x
            read_f32(240), // y
            read_f32(244), // z
            read_f32(232), // w
        )
        .normalize();

        cloud.positions.push(pos);
        cloud.opacities.push(opacity);
        cloud.scales.push(scale);
        cloud.rotations.push(rot);
        cloud.sh_coeffs.push(sh);
    }

    cloud.count = count;
    Ok(cloud)
}

/// Parse ASCII PLY data
fn parse_ascii(content: &str, count: usize) -> Result<GaussianCloud> {
    let mut cloud = GaussianCloud::with_capacity(count);

    for (i, line) in content.lines().take(count).enumerate() {
        let values: Vec<f32> = line
            .split_whitespace()
            .filter_map(|s| s.parse().ok())
            .collect();

        if values.len() < 62 {
            return Err(SplatsError::Ply(format!(
                "Line {}: expected 62 properties, got {}",
                i + 1,
                values.len()
            )));
        }

        // Position (indices 0-2)
        let pos = Vec3::new(values[0], values[1], values[2]);

        // Skip normals (indices 3-5)

        // SH coefficients (indices 6-53)
        let mut sh = [0.0f32; 48];
        sh[0] = values[6]; // f_dc_0
        sh[1] = values[7]; // f_dc_1
        sh[2] = values[8]; // f_dc_2
        for j in 0..45 {
            sh[3 + j] = values[9 + j]; // f_rest_0..44
        }

        // Opacity (index 54) - stored as logit
        let opacity = sigmoid(values[54]);

        // Scale (indices 55-57) - stored as log
        let scale = Vec3::new(values[55].exp(), values[56].exp(), values[57].exp());

        // Rotation (indices 58-61) - w, x, y, z order
        let rot = Quat::from_xyzw(values[59], values[60], values[61], values[58]).normalize();

        cloud.positions.push(pos);
        cloud.opacities.push(opacity);
        cloud.scales.push(scale);
        cloud.rotations.push(rot);
        cloud.sh_coeffs.push(sh);
    }

    cloud.count = cloud.positions.len();
    Ok(cloud)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sigmoid() {
        assert!((sigmoid(0.0) - 0.5).abs() < 1e-6);
        assert!(sigmoid(10.0) > 0.99);
        assert!(sigmoid(-10.0) < 0.01);
    }

    #[test]
    fn test_parse_vertex_count() {
        let header = "ply\nformat binary_little_endian 1.0\nelement vertex 12345\n";
        assert_eq!(parse_vertex_count(header).unwrap(), 12345);
    }

    #[test]
    fn test_parse_vertex_count_missing() {
        let header = "ply\nformat binary_little_endian 1.0\n";
        assert!(parse_vertex_count(header).is_err());
    }
}
