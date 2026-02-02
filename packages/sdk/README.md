# @stereos/sdk

[![npm version](https://badge.fury.io/js/@stereos%2Fsdk.svg)](https://www.npmjs.com/package/@stereos/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> Client SDK for Stereos — Convert 3D Gaussian splats to optimized glTF/glb format entirely in the browser using WebAssembly.

## Features

- 🚀 **Browser-native processing** — All conversion happens client-side via WebAssembly
- 📦 **Zero dependencies** — Lightweight SDK with no external runtime dependencies
- 🔐 **Secure token-based auth** — Short-lived JWTs for safe API access
- 🧹 **Built-in cleaning** — Remove low-quality splats automatically
- 🗜️ **Advanced compression** — Position quantization and meshopt compression support
- 🎨 **View-dependent rendering** — Optional full spherical harmonics export

## Installation

```bash
npm install @stereos/sdk
```

## Quick Start

```typescript
import { Stereos } from '@stereos/sdk';

// Initialize with your API key
const stereos = new Stereos({ apiKey: 'sk_live_...' });

// Convert a PLY file to glb
const result = await stereos.convert(plyFile);

// Download the result
Stereos.download(result);
```

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  Stereos    │───▶│  WASM Core  │───▶│  glTF/glb Output │  │
│  │   Client    │    │ (stereos-wasm)│   │                  │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  Token API  │  (Secure short-lived JWT authentication)     │
│  └─────────────┘                                             │
└─────────────────────────────────────────────────────────────┘
```

### Components

#### 1. Stereos Client ([`src/client.ts`](src/client.ts))

The main SDK class that orchestrates:
- **Token management**: Automatically fetches and caches JWT tokens from the API
- **WASM loading**: Lazy-loads the WebAssembly module on first use
- **Conversion pipeline**: Handles file reading, WASM execution, and result formatting

```typescript
class Stereos {
  private apiKey: string;
  private wasm: WasmModule | null;
  private token: string | null;
  
  async convert(file, options): Promise<ConvertResult>
  async validateToken(): Promise<TokenClaims>
  static download(result): void
}
```

#### 2. WASM Module (`wasm/`)

Compiled from Rust ([`crates/stereos-wasm`](../crates/stereos-wasm/)) using `wasm-bindgen`:
- **Core processing**: PLY parsing, cleaning algorithms, glTF generation
- **Zero-copy**: Efficient memory sharing between JS and WASM
- **Streaming**: Supports incremental processing of large files

#### 3. Types ([`src/types.ts`](src/types.ts))

TypeScript interfaces for:
- Configuration options
- API responses
- Conversion results
- Cleaning statistics

## API Reference

### `Stereos` Class

#### Constructor

```typescript
new Stereos(options: StereosOptions): Stereos
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiKey` | `string` | ✅ | Your Stereos API key |

#### Methods

##### `convert(file, options?)`

Convert a PLY file to glTF/glb format.

```typescript
async convert(
  file: File | Blob | ArrayBuffer | Uint8Array,
  options?: ConvertOptions
): Promise<ConvertResult>
```

**ConvertOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `format` | `'glb' \| 'gltf'` | `'glb'` | Output format |
| `quantizeColors` | `boolean` | `true` | Quantize colors to u8 |
| `exportFullSh` | `boolean` | `false` | Export all 48 SH coefficients |
| `quantizePositions` | `boolean` | `false` | Quantize positions to i16 |
| `meshoptCompression` | `boolean` | `false` | Enable meshopt compression |
| `clean` | `boolean \| CleanOptions` | `false` | Enable cleaning/filtering |

**CleanOptions (when `clean` is an object):**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `minOpacity` | `number` | `0.005` | Remove splats below this opacity |
| `minScale` | `number` | `0.0001` | Remove splats smaller than this |
| `outlierSigma` | `number` | — | Remove outliers N std devs from centroid |

##### `validateToken()`

Validate the current token and return its claims.

```typescript
async validateToken(): Promise<TokenClaims>
```

Returns:
```typescript
interface TokenClaims {
  sub: string;           // API key ID
  exp: number;           // Expiration timestamp
  iat: number;           // Issued at timestamp
  conversions_remaining: number;
  max_file_size: number;
  formats: string[];
}
```

##### `version()`

Get the SDK/WASM version.

```typescript
async version(): Promise<string>
```

##### `Stereos.download(result)` (static)

Trigger a browser download of the conversion result.

```typescript
static download(result: ConvertResult): void
```

##### `Stereos.createDownloadUrl(result)` (static)

Create a blob URL for the conversion result.

```typescript
static createDownloadUrl(result: ConvertResult): string
```

## Types Reference

### Core Types

#### `StereosOptions`

```typescript
interface StereosOptions {
  /** Your API key */
  apiKey: string;
}
```

#### `ConvertResult`

```typescript
interface ConvertResult {
  /** The converted file data */
  data: Uint8Array;
  /** Output format */
  format: "glb" | "gltf";
  /** Suggested filename */
  filename: string;
  /** Cleaning statistics (if cleaning was enabled) */
  cleanStats?: CleanStats;
}
```

#### `CleanStats`

```typescript
interface CleanStats {
  /** Number of splats before cleaning */
  original_count: number;
  /** Number of splats removed due to low opacity */
  removed_low_opacity: number;
  /** Number of splats removed due to small scale */
  removed_small_scale: number;
  /** Number of splats removed as outliers */
  removed_outliers: number;
  /** Number of splats after cleaning */
  final_count: number;
}
```

#### `ApiError`

```typescript
interface ApiError {
  error: string;       // Error code
  message?: string;    // Human-readable message
}
```

## Usage Examples

### Basic Conversion

```typescript
import { Stereos } from '@stereos/sdk';

const stereos = new Stereos({ apiKey: 'sk_live_...' });
const result = await stereos.convert(plyFile);
Stereos.download(result);
```

### With File Input

```typescript
const fileInput = document.getElementById('file');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const result = await stereos.convert(file, { format: 'glb' });
  Stereos.download(result);
});
```

### Maximum Compression

Best for web delivery — smallest file size:

```typescript
const result = await stereos.convert(file, {
  format: 'glb',
  quantizeColors: true,      // u8 colors (default)
  quantizePositions: true,   // i16 positions (~2x smaller)
  clean: true,               // Remove low-quality splats
  exportFullSh: false,       // DC colors only
  meshoptCompression: true,  // Additional 2-4x compression
});
```

### Full Quality Export

For view-dependent rendering with full spherical harmonics:

```typescript
const result = await stereos.convert(file, {
  format: 'glb',
  quantizeColors: false,     // Keep f32 precision
  exportFullSh: true,        // All 48 SH coefficients
  clean: {
    minOpacity: 0.001,       // Keep more splats
    minScale: 0.00005,
  },
});
```

### Cleaning with Custom Options

```typescript
const result = await stereos.convert(file, {
  clean: {
    minOpacity: 0.01,        // Aggressive opacity filtering
    minScale: 0.001,         // Remove tiny splats
    outlierSigma: 3,         // Remove statistical outliers
  },
});

if (result.cleanStats) {
  const { original_count, final_count, removed_outliers } = result.cleanStats;
  console.log(`Cleaned: ${original_count} → ${final_count} splats`);
  console.log(`Removed ${removed_outliers} outliers`);
}
```

### Check Token Status

```typescript
const claims = await stereos.validateToken();
console.log(`Conversions remaining: ${claims.conversions_remaining}`);
console.log(`Max file size: ${claims.max_file_size} bytes`);
```

### Error Handling

```typescript
try {
  const result = await stereos.convert(file);
} catch (error) {
  if (error.message.includes('401')) {
    console.error('Invalid API key');
  } else if (error.message.includes('quota')) {
    console.error('Out of conversions');
  } else {
    console.error('Conversion failed:', error.message);
  }
}
```

## Testing

All tests are currently **passing** ✅

Run tests with: `cargo test -p stereos-core`

### Test Files

#### [`crates/stereos-core/src/lib.rs`](../crates/stereos-core/src/lib.rs)
Core library tests:
- `test_gaussian_cloud_capacity` — Validates GaussianCloud capacity calculations
- `test_export_config_default` — Tests default ExportConfig values

#### [`crates/stereos-core/src/token.rs`](../crates/stereos-core/src/token.rs)
JWT token validation tests:
- `test_claims_allows_format` — Tests format permission checking in claims
- `test_validate_invalid_key` — Tests invalid API key rejection (native only)

#### [`crates/stereos-core/src/ply.rs`](../crates/stereos-core/src/ply.rs)
PLY file parsing tests:
- `test_sigmoid` — Tests sigmoid activation function
- `test_parse_vertex_count` — Tests vertex count extraction from PLY header
- `test_parse_vertex_count_missing` — Tests handling of missing element vertex

#### [`crates/stereos-core/src/clean.rs`](../crates/stereos-core/src/clean.rs)
Cleaning/filtering algorithm tests:
- `test_clean_removes_low_opacity_splats` — Opacity threshold filtering
- `test_clean_keeps_splats_at_opacity_threshold` — Boundary condition handling
- `test_clean_removes_small_scale_splats` — Scale-based filtering
- `test_clean_keeps_splat_if_any_scale_dimension_large_enough` — Multi-dimensional scale check
- `test_clean_removes_outliers_by_sigma` — Statistical outlier removal
- `test_clean_no_outlier_removal_when_sigma_none` — Optional outlier skipping
- `test_clean_applies_all_filters` — Combined filter application
- `test_clean_stats_count_each_removal_reason_once` — Statistics accuracy
- `test_clean_empty_cloud` — Empty input handling
- `test_clean_preserves_all_attributes` — Data preservation verification
- `test_clean_with_default_options` — Default options behavior

#### [`crates/stereos-core/src/gltf.rs`](../crates/stereos-core/src/gltf.rs)
glTF/glb export tests:
- `test_sh_to_rgba` — Spherical harmonics to RGBA conversion
- `test_sh_to_rgba_with_values` — SH conversion with specific values
- `test_export_glb_structure` — GLB binary structure validation
- `test_export_glb_with_stats_structure` — GLB with embedded stats
- `test_export_gltf_embedded` — Embedded glTF JSON export
- `test_compute_bounds` — Bounding box calculations
- `test_compute_bounds_empty` — Empty cloud bounds handling
- `test_compute_bounds_single_point` — Single point bounds
- `test_export_with_full_sh` — Full spherical harmonics export (48 coefficients)
- `test_export_dc_only_no_sh_attribute` — Diffuse color only export
- `test_export_with_position_quantization` — Position quantization to i16
- `test_export_without_position_quantization` — Full precision positions
- `test_full_sh_buffer_size_larger` — Buffer size verification for SH data
- `test_quantized_positions_smaller` — Quantization size reduction
- `test_quantized_positions_bounds_accuracy` — Quantization precision
- `test_export_with_meshopt_compression` — Meshopt compression (with feature flag)
- `test_meshopt_compression_reduces_size` — Compression ratio verification
- `test_meshopt_buffers_have_correct_layout` — Buffer layout validation
- `test_meshopt_compression_stats` — Compression statistics
- `test_export_without_meshopt_no_extension` — Without compression flag
- `test_color_quantization` — Color quantization to u8
- `test_empty_cloud` — Empty cloud export handling
- `test_large_cloud` — Large dataset performance
- `test_compression_stats_structure` — Stats metadata structure

### Test Coverage Summary

| Module | Test Count | Coverage |
|-----------|--------|----------|
| `lib.rs` | 2 | Core data structures |
| `token.rs` | 2 | JWT validation |
| `ply.rs` | 3 | PLY parsing |
| `clean.rs` | 11 | Cleaning algorithms |
| `gltf.rs` | 24 | glTF/glb export |
| **Total** | **42** | **Comprehensive** |

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 80+ | Full support |
| Firefox | 75+ | Full support |
| Safari | 14+ | Full support |
| Edge | 80+ | Full support |

Requirements:
- WebAssembly (Wasm) support
- ES2020+ (BigInt, dynamic imports)

### Project Structure

```
packages/sdk/
├── src/
│   ├── client.ts       # Main Stereos class
│   ├── types.ts        # TypeScript interfaces
│   └── index.ts        # Public exports
├── wasm/               # WebAssembly files (generated)
│   ├── stereos_wasm.js
│   ├── stereos_wasm_bg.wasm
│   └── *.d.ts
├── dist/               # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Support

- Documentation: In Development
- Issues: https://github.com/StereosOrg/stereos/issues
- Email: james@atelierlogos.studio