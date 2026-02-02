//! Cleaning and filtering for Gaussian Splat data
//!
//! Removes low-quality splats to reduce file size and improve rendering performance.

use crate::GaussianCloud;

/// Configuration for cleaning operations
#[derive(Clone, Debug)]
pub struct CleanOptions {
    /// Remove splats with opacity below this threshold (default: 0.005 = 0.5%)
    pub min_opacity: f32,
    /// Remove splats smaller than this in all dimensions (default: 0.0001)
    pub min_scale: f32,
    /// Remove splats beyond N standard deviations from centroid (default: None)
    pub outlier_sigma: Option<f32>,
}

impl Default for CleanOptions {
    fn default() -> Self {
        Self {
            min_opacity: 0.005,
            min_scale: 0.0001,
            outlier_sigma: None,
        }
    }
}

/// Statistics from a cleaning operation
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CleanStats {
    /// Number of splats before cleaning
    pub original_count: usize,
    /// Number of splats removed due to low opacity
    pub removed_low_opacity: usize,
    /// Number of splats removed due to small scale
    pub removed_small_scale: usize,
    /// Number of splats removed as outliers
    pub removed_outliers: usize,
    /// Number of splats after cleaning
    pub final_count: usize,
}

impl GaussianCloud {
    /// Clean the cloud by removing low-quality splats
    ///
    /// Returns a new cloud with filtered splats and statistics about what was removed.
    ///
    /// Filters are applied in order: opacity, scale, outlier.
    /// Each splat is counted only once in the stats (first filter that removes it).
    pub fn clean(&self, options: &CleanOptions) -> (GaussianCloud, CleanStats) {
        use glam::Vec3;

        let mut stats = CleanStats {
            original_count: self.count,
            ..Default::default()
        };

        // Track which indices to keep
        let mut keep_indices: Vec<usize> = (0..self.count).collect();

        // Phase 1: Filter by opacity
        let mut after_opacity = Vec::new();
        for &i in &keep_indices {
            if self.opacities[i] >= options.min_opacity {
                after_opacity.push(i);
            } else {
                stats.removed_low_opacity += 1;
            }
        }
        keep_indices = after_opacity;

        // Phase 2: Filter by scale (keep if ANY dimension is >= threshold)
        let mut after_scale = Vec::new();
        for &i in &keep_indices {
            let scale = self.scales[i];
            if scale.x >= options.min_scale
                || scale.y >= options.min_scale
                || scale.z >= options.min_scale
            {
                after_scale.push(i);
            } else {
                stats.removed_small_scale += 1;
            }
        }
        keep_indices = after_scale;

        // Phase 3: Filter outliers by sigma (if enabled)
        // Uses median and MAD (median absolute deviation) for robustness against outliers
        // Requires at least 3 points to meaningfully detect outliers
        if let Some(sigma_threshold) = options.outlier_sigma {
            if keep_indices.len() > 2 {
                // Compute median position (robust centroid)
                let mut xs: Vec<f32> = keep_indices.iter().map(|&i| self.positions[i].x).collect();
                let mut ys: Vec<f32> = keep_indices.iter().map(|&i| self.positions[i].y).collect();
                let mut zs: Vec<f32> = keep_indices.iter().map(|&i| self.positions[i].z).collect();

                xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
                ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
                zs.sort_by(|a, b| a.partial_cmp(b).unwrap());

                let median = |sorted: &[f32]| -> f32 {
                    let n = sorted.len();
                    if n % 2 == 0 {
                        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
                    } else {
                        sorted[n / 2]
                    }
                };

                let center = Vec3::new(median(&xs), median(&ys), median(&zs));

                // Compute distances from median center
                let distances: Vec<f32> = keep_indices
                    .iter()
                    .map(|&i| self.positions[i].distance(center))
                    .collect();

                // Compute MAD (median absolute deviation) of distances
                let mut sorted_distances = distances.clone();
                sorted_distances.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let median_distance = median(&sorted_distances);

                let mut abs_deviations: Vec<f32> = sorted_distances
                    .iter()
                    .map(|&d| (d - median_distance).abs())
                    .collect();
                abs_deviations.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let mad = median(&abs_deviations);

                // MAD to standard deviation conversion factor for normal distribution
                // sigma ≈ 1.4826 * MAD
                let robust_sigma = 1.4826 * mad;
                let max_distance = median_distance + sigma_threshold * robust_sigma;

                // Filter out outliers
                let mut after_outlier = Vec::new();
                for (idx, &i) in keep_indices.iter().enumerate() {
                    if distances[idx] <= max_distance {
                        after_outlier.push(i);
                    } else {
                        stats.removed_outliers += 1;
                    }
                }
                keep_indices = after_outlier;
            }
        }

        // Build the cleaned cloud
        let mut cleaned = GaussianCloud::with_capacity(keep_indices.len());
        for &i in &keep_indices {
            cleaned.positions.push(self.positions[i]);
            cleaned.opacities.push(self.opacities[i]);
            cleaned.scales.push(self.scales[i]);
            cleaned.rotations.push(self.rotations[i]);
            cleaned.sh_coeffs.push(self.sh_coeffs[i]);
        }
        cleaned.count = keep_indices.len();

        stats.final_count = cleaned.count;

        (cleaned, stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glam::{Quat, Vec3};

    /// Helper to create a test cloud with specific properties
    fn make_test_cloud(splats: Vec<(Vec3, f32, Vec3)>) -> GaussianCloud {
        let count = splats.len();
        let mut cloud = GaussianCloud::with_capacity(count);

        for (pos, opacity, scale) in splats {
            cloud.positions.push(pos);
            cloud.opacities.push(opacity);
            cloud.scales.push(scale);
            cloud.rotations.push(Quat::IDENTITY);
            cloud.sh_coeffs.push([0.0; 48]);
        }
        cloud.count = count;
        cloud
    }

    // ==================== Opacity Filter Tests ====================

    #[test]
    fn test_clean_removes_low_opacity_splats() {
        let cloud = make_test_cloud(vec![
            (Vec3::ZERO, 0.001, Vec3::ONE),  // Below threshold - should be removed
            (Vec3::X, 0.5, Vec3::ONE),       // Above threshold - keep
            (Vec3::Y, 0.003, Vec3::ONE),     // Below threshold - should be removed
            (Vec3::Z, 0.01, Vec3::ONE),      // Above threshold - keep
        ]);

        let options = CleanOptions {
            min_opacity: 0.005,
            min_scale: 0.0,
            outlier_sigma: None,
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.original_count, 4);
        assert_eq!(stats.removed_low_opacity, 2);
        assert_eq!(stats.final_count, 2);
        assert_eq!(cleaned.count, 2);
        assert_eq!(cleaned.opacities, vec![0.5, 0.01]);
    }

    #[test]
    fn test_clean_keeps_splats_at_opacity_threshold() {
        let cloud = make_test_cloud(vec![
            (Vec3::ZERO, 0.005, Vec3::ONE),  // Exactly at threshold - keep
            (Vec3::X, 0.0049, Vec3::ONE),    // Just below - remove
        ]);

        let options = CleanOptions {
            min_opacity: 0.005,
            min_scale: 0.0,
            outlier_sigma: None,
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.removed_low_opacity, 1);
        assert_eq!(cleaned.count, 1);
        assert_eq!(cleaned.opacities[0], 0.005);
    }

    // ==================== Scale Filter Tests ====================

    #[test]
    fn test_clean_removes_small_scale_splats() {
        let cloud = make_test_cloud(vec![
            (Vec3::ZERO, 1.0, Vec3::new(0.00001, 0.00001, 0.00001)),  // All dims tiny - remove
            (Vec3::X, 1.0, Vec3::new(0.1, 0.1, 0.1)),                  // Large enough - keep
            (Vec3::Y, 1.0, Vec3::new(0.00005, 0.00005, 0.00005)),     // All dims tiny - remove
        ]);

        let options = CleanOptions {
            min_opacity: 0.0,
            min_scale: 0.0001,
            outlier_sigma: None,
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.original_count, 3);
        assert_eq!(stats.removed_small_scale, 2);
        assert_eq!(stats.final_count, 1);
        assert_eq!(cleaned.count, 1);
    }

    #[test]
    fn test_clean_keeps_splat_if_any_scale_dimension_large_enough() {
        // If at least one dimension is above threshold, keep the splat
        let cloud = make_test_cloud(vec![
            (Vec3::ZERO, 1.0, Vec3::new(0.00001, 0.00001, 0.001)),  // Z is large - keep
            (Vec3::X, 1.0, Vec3::new(0.001, 0.00001, 0.00001)),     // X is large - keep
            (Vec3::Y, 1.0, Vec3::new(0.00001, 0.00001, 0.00001)),   // All tiny - remove
        ]);

        let options = CleanOptions {
            min_opacity: 0.0,
            min_scale: 0.0001,
            outlier_sigma: None,
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.removed_small_scale, 1);
        assert_eq!(cleaned.count, 2);
    }

    // ==================== Outlier Filter Tests ====================

    #[test]
    fn test_clean_removes_outliers_by_sigma() {
        // Create a cluster around origin with one far outlier
        let cloud = make_test_cloud(vec![
            (Vec3::new(0.0, 0.0, 0.0), 1.0, Vec3::ONE),
            (Vec3::new(0.1, 0.0, 0.0), 1.0, Vec3::ONE),
            (Vec3::new(-0.1, 0.0, 0.0), 1.0, Vec3::ONE),
            (Vec3::new(0.0, 0.1, 0.0), 1.0, Vec3::ONE),
            (Vec3::new(0.0, -0.1, 0.0), 1.0, Vec3::ONE),
            (Vec3::new(100.0, 0.0, 0.0), 1.0, Vec3::ONE),  // Far outlier
        ]);

        let options = CleanOptions {
            min_opacity: 0.0,
            min_scale: 0.0,
            outlier_sigma: Some(3.0),  // 3 standard deviations
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.original_count, 6);
        assert_eq!(stats.removed_outliers, 1);
        assert_eq!(stats.final_count, 5);
        assert_eq!(cleaned.count, 5);
    }

    #[test]
    fn test_clean_no_outlier_removal_when_sigma_none() {
        let cloud = make_test_cloud(vec![
            (Vec3::new(0.0, 0.0, 0.0), 1.0, Vec3::ONE),
            (Vec3::new(100.0, 0.0, 0.0), 1.0, Vec3::ONE),  // Would be outlier if enabled
        ]);

        let options = CleanOptions {
            min_opacity: 0.0,
            min_scale: 0.0,
            outlier_sigma: None,
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.removed_outliers, 0);
        assert_eq!(cleaned.count, 2);
    }

    // ==================== Combined Filter Tests ====================

    #[test]
    fn test_clean_applies_all_filters() {
        let cloud = make_test_cloud(vec![
            (Vec3::ZERO, 0.001, Vec3::ONE),                           // Low opacity - remove
            (Vec3::X, 1.0, Vec3::new(0.00001, 0.00001, 0.00001)),     // Small scale - remove
            (Vec3::new(100.0, 0.0, 0.0), 1.0, Vec3::ONE),             // Outlier - remove
            (Vec3::new(0.1, 0.1, 0.1), 0.5, Vec3::ONE),               // Good - keep
            (Vec3::new(0.0, 0.0, 0.0), 0.5, Vec3::ONE),               // Good - keep
            (Vec3::new(0.2, 0.0, 0.0), 0.5, Vec3::ONE),               // Good - keep
            (Vec3::new(0.0, 0.2, 0.0), 0.5, Vec3::ONE),               // Good - keep
        ]);

        let options = CleanOptions {
            min_opacity: 0.005,
            min_scale: 0.0001,
            outlier_sigma: Some(3.0),
        };

        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.original_count, 7);
        assert_eq!(stats.removed_low_opacity, 1);
        assert_eq!(stats.removed_small_scale, 1);
        assert_eq!(stats.removed_outliers, 1);
        assert_eq!(stats.final_count, 4);
        assert_eq!(cleaned.count, 4);
    }

    #[test]
    fn test_clean_stats_count_each_removal_reason_once() {
        // A splat that fails multiple filters should only be counted once
        // (in order: opacity, then scale, then outlier)
        let cloud = make_test_cloud(vec![
            (Vec3::new(100.0, 0.0, 0.0), 0.001, Vec3::new(0.00001, 0.00001, 0.00001)),  // Fails all!
            (Vec3::ZERO, 1.0, Vec3::ONE),  // Good - keep
        ]);

        let options = CleanOptions {
            min_opacity: 0.005,
            min_scale: 0.0001,
            outlier_sigma: Some(3.0),
        };

        let (cleaned, stats) = cloud.clean(&options);

        // The bad splat should be counted only once (removed for low opacity first)
        assert_eq!(stats.original_count, 2);
        assert_eq!(stats.removed_low_opacity, 1);
        assert_eq!(stats.removed_small_scale, 0);  // Already removed for opacity
        assert_eq!(stats.removed_outliers, 0);      // Already removed for opacity
        assert_eq!(stats.final_count, 1);
        assert_eq!(cleaned.count, 1);
    }

    // ==================== Edge Cases ====================

    #[test]
    fn test_clean_empty_cloud() {
        let cloud = GaussianCloud::with_capacity(0);

        let options = CleanOptions::default();
        let (cleaned, stats) = cloud.clean(&options);

        assert_eq!(stats.original_count, 0);
        assert_eq!(stats.final_count, 0);
        assert_eq!(cleaned.count, 0);
    }

    #[test]
    fn test_clean_preserves_all_attributes() {
        let mut cloud = GaussianCloud::with_capacity(2);

        // Add two splats with distinct attributes
        cloud.positions.push(Vec3::new(1.0, 2.0, 3.0));
        cloud.opacities.push(0.8);
        cloud.scales.push(Vec3::new(0.1, 0.2, 0.3));
        cloud.rotations.push(Quat::from_xyzw(0.0, 0.0, 0.707, 0.707));
        let mut sh1 = [0.0f32; 48];
        sh1[0] = 1.0;
        sh1[1] = 2.0;
        sh1[2] = 3.0;
        cloud.sh_coeffs.push(sh1);

        // This one will be filtered out
        cloud.positions.push(Vec3::ZERO);
        cloud.opacities.push(0.001);  // Low opacity
        cloud.scales.push(Vec3::ONE);
        cloud.rotations.push(Quat::IDENTITY);
        cloud.sh_coeffs.push([0.0; 48]);

        cloud.count = 2;

        let options = CleanOptions {
            min_opacity: 0.005,
            min_scale: 0.0,
            outlier_sigma: None,
        };

        let (cleaned, _) = cloud.clean(&options);

        assert_eq!(cleaned.count, 1);
        assert_eq!(cleaned.positions[0], Vec3::new(1.0, 2.0, 3.0));
        assert_eq!(cleaned.opacities[0], 0.8);
        assert_eq!(cleaned.scales[0], Vec3::new(0.1, 0.2, 0.3));
        assert_eq!(cleaned.rotations[0], Quat::from_xyzw(0.0, 0.0, 0.707, 0.707));
        assert_eq!(cleaned.sh_coeffs[0][0], 1.0);
        assert_eq!(cleaned.sh_coeffs[0][1], 2.0);
        assert_eq!(cleaned.sh_coeffs[0][2], 3.0);
    }

    #[test]
    fn test_clean_with_default_options() {
        let cloud = make_test_cloud(vec![
            (Vec3::ZERO, 0.001, Vec3::ONE),  // Below default 0.005 opacity
            (Vec3::X, 0.5, Vec3::ONE),       // Good
        ]);

        let (cleaned, stats) = cloud.clean(&CleanOptions::default());

        assert_eq!(stats.removed_low_opacity, 1);
        assert_eq!(cleaned.count, 1);
    }
}
