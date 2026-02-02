import type {
  StereosOptions,
  ConvertOptions,
  ConvertResult,
  TokenClaims,
  TokenResponse,
  CleanOptions,
  CleanStats,
} from "./types";

/**
 * WASM module interface
 */
interface WasmModule {
  convert_ply: (
    data: Uint8Array,
    token: string,
    options?: ConvertOptionsWasm
  ) => Uint8Array;
  convert_ply_with_stats: (
    data: Uint8Array,
    token: string,
    options?: ConvertOptionsWasm
  ) => ConvertResultWasm;
  validate_token: (token: string) => TokenClaims;
  version: () => string;
  ConvertOptions: new () => ConvertOptionsWasm;
  CleanOptions: new () => CleanOptionsWasm;
}

interface ConvertOptionsWasm {
  format: string;
  quantize_colors: boolean;
  exportFullSh: boolean;
  quantizePositions: boolean;
  meshoptCompression: boolean;
  setCleanOptions: (options: CleanOptionsWasm) => void;
  enableCleaning: () => void;
  disableCleaning: () => void;
}

interface CleanOptionsWasm {
  min_opacity: number;
  min_scale: number;
  setOutlierSigma: (value: number) => void;
  disableOutlierRemoval: () => void;
}

interface ConvertResultWasm {
  data: Uint8Array;
  cleanStats?: CleanStats;
}

/**
 * Stereos SDK client for converting Gaussian splats to glTF
 *
 * @example
 * ```typescript
 * import { Stereos } from '@stereos/sdk';
 *
 * const stereos = new Stereos({ apiKey: 'sk_live_...' });
 * const result = await stereos.convert(plyFile, { format: 'glb' });
 * ```
 */
export class Stereos {
  private apiKey: string;
  private apiUrl = "https://stereos-api.jdbohrman.workers.dev";
  private wasm: WasmModule | null = null;
  private wasmLoading: Promise<void> | null = null;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  /**
   * Create a new Stereos SDK instance
   *
   * @param options - Configuration options
   */
  constructor(options: StereosOptions) {
    if (!options.apiKey) {
      throw new Error("API key is required");
    }
    this.apiKey = options.apiKey;
  }

  /**
   * Load the WASM module
   */
  private async loadWasm(): Promise<void> {
    if (this.wasm) return;

    if (this.wasmLoading) {
      await this.wasmLoading;
      return;
    }

    this.wasmLoading = (async () => {
      // Dynamic import of the WASM module
      // The WASM files should be in the 'wasm' directory of the package
      const wasmModule = await import("../wasm/stereos_wasm.js");
      await wasmModule.default();
      this.wasm = wasmModule as unknown as WasmModule;
    })();

    await this.wasmLoading;
  }

  /**
   * Ensure we have a valid token, fetching a new one if needed
   */
  private async ensureToken(): Promise<string> {
    const now = Date.now() / 1000;

    // Refresh if expired or expiring within 30 seconds
    if (this.token && this.tokenExpiry > now + 30) {
      return this.token;
    }

    const response = await fetch(`${this.apiUrl}/v1/tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        error.message ?? error.error ?? `Token request failed: ${response.status}`
      );
    }

    const data: TokenResponse = await response.json();
    this.token = data.token;
    this.tokenExpiry = data.expires_at;

    return data.token;
  }

  /**
   * Configure WASM cleaning options based on user options
   */
  private configureCleanOptions(
    wasmOptions: ConvertOptionsWasm,
    cleanOption: boolean | CleanOptions
  ): void {
    if (cleanOption === true) {
      // Use defaults
      wasmOptions.enableCleaning();
    } else if (typeof cleanOption === "object") {
      const cleanOpts = new this.wasm!.CleanOptions();

      if (cleanOption.minOpacity !== undefined) {
        cleanOpts.min_opacity = cleanOption.minOpacity;
      }
      if (cleanOption.minScale !== undefined) {
        cleanOpts.min_scale = cleanOption.minScale;
      }
      if (cleanOption.outlierSigma !== undefined) {
        cleanOpts.setOutlierSigma(cleanOption.outlierSigma);
      }

      wasmOptions.setCleanOptions(cleanOpts);
    }
  }

  /**
   * Convert a PLY file to glTF/glb format
   *
   * @param file - The PLY file to convert (File, Blob, ArrayBuffer, or Uint8Array)
   * @param options - Conversion options
   * @returns The converted file data and metadata
   *
   * @example
   * ```typescript
   * // Basic conversion
   * const result = await stereos.convert(file);
   *
   * // With cleaning enabled (removes low-quality splats)
   * const result = await stereos.convert(file, { clean: true });
   *
   * // Maximum compression (quantize positions, clean, DC-only colors)
   * const result = await stereos.convert(file, {
   *   quantizePositions: true,  // ~2x smaller positions
   *   clean: true,              // Remove low-quality splats
   * });
   *
   * // Full quality (view-dependent rendering)
   * const result = await stereos.convert(file, {
   *   exportFullSh: true,       // Export all 48 SH coefficients
   *   quantizeColors: false,    // Keep f32 colors
   * });
   *
   * // Access cleaning stats
   * if (result.cleanStats) {
   *   console.log(`Removed ${result.cleanStats.original_count - result.cleanStats.final_count} splats`);
   * }
   * ```
   */
  async convert(
    file: File | Blob | ArrayBuffer | Uint8Array,
    options: ConvertOptions = {}
  ): Promise<ConvertResult> {
    // Load WASM and get token in parallel
    const [, token] = await Promise.all([this.loadWasm(), this.ensureToken()]);

    // Get file data as Uint8Array
    let data: Uint8Array;
    if (file instanceof Uint8Array) {
      data = file;
    } else if (file instanceof ArrayBuffer) {
      data = new Uint8Array(file);
    } else {
      const buffer = await file.arrayBuffer();
      data = new Uint8Array(buffer);
    }

    // Configure WASM options
    const wasmOptions = new this.wasm!.ConvertOptions();
    wasmOptions.format = options.format ?? "glb";
    wasmOptions.quantize_colors = options.quantizeColors ?? true;
    wasmOptions.exportFullSh = options.exportFullSh ?? false;
    wasmOptions.quantizePositions = options.quantizePositions ?? false;
    wasmOptions.meshoptCompression = options.meshoptCompression ?? false;

    // Configure cleaning if requested
    if (options.clean) {
      this.configureCleanOptions(wasmOptions, options.clean);
    }

    const format = options.format ?? "glb";

    // Generate filename
    let filename = options.filename ?? "output";
    if (!filename.endsWith(`.${format}`)) {
      filename = filename.replace(/\.(ply|glb|gltf)$/i, "") + `.${format}`;
    }

    // Perform conversion - use stats version if cleaning is enabled
    if (options.clean) {
      const result = this.wasm!.convert_ply_with_stats(data, token, wasmOptions);
      return {
        data: result.data,
        format,
        filename,
        cleanStats: result.cleanStats,
      };
    } else {
      const result = this.wasm!.convert_ply(data, token, wasmOptions);
      return {
        data: result,
        format,
        filename,
      };
    }
  }

  /**
   * Validate the current token and return its claims
   *
   * @returns Token claims including remaining conversions and limits
   */
  async validateToken(): Promise<TokenClaims> {
    await this.loadWasm();
    const token = await this.ensureToken();
    return this.wasm!.validate_token(token);
  }

  /**
   * Get the SDK version
   *
   * @returns The version string
   */
  async version(): Promise<string> {
    await this.loadWasm();
    return this.wasm!.version();
  }

  /**
   * Create a download link for conversion result
   *
   * @param result - The conversion result
   * @returns Object URL that can be used for download
   */
  static createDownloadUrl(result: ConvertResult): string {
    const mimeType =
      result.format === "glb" ? "model/gltf-binary" : "model/gltf+json";
    const blob = new Blob([result.data as BlobPart], { type: mimeType });
    return URL.createObjectURL(blob);
  }

  /**
   * Trigger a download of the conversion result
   *
   * @param result - The conversion result
   */
  static download(result: ConvertResult): void {
    const url = Stereos.createDownloadUrl(result);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
