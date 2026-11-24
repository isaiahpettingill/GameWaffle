use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct Camera {
    pub min_width: u32,
    pub min_height: u32,
    pub max_width: u32,
    pub max_height: u32,
    pub zoom: u32,
    pub resolution: Option<[u32; 2]>,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            min_width: 128,
            min_height: 128,
            max_width: 512,
            max_height: 512,
            zoom: 2,
            resolution: None,
        }
    }
}

impl Camera {
    pub(crate) fn valid(self) -> bool {
        (128..=512).contains(&self.min_width)
            && (128..=512).contains(&self.min_height)
            && (self.min_width..=512).contains(&self.max_width)
            && (self.min_height..=512).contains(&self.max_height)
            && (1..=8).contains(&self.zoom)
            && self.resolution.is_none_or(|size| size.iter().all(|axis| (64..=512).contains(axis)))
    }

    pub fn fixed_resolution(self) -> Option<[u32; 2]> {
        self.resolution
            .map(|size| size.map(|axis| axis.clamp(64, 512)))
    }

    pub fn view_size(self, window: [u32; 2], script_zoom: Option<f32>) -> [u32; 2] {
        let zoom = self.zoom.max(1);
        let dimension = |pixels: u32, min: u32, max: u32| {
            let min = min.clamp(128, 512);
            (pixels / zoom).clamp(min, max.clamp(min, 512))
        };
        self.fixed_resolution()
            .unwrap_or_else(|| {
                [
                    dimension(window[0], self.min_width, self.max_width),
                    dimension(window[1], self.min_height, self.max_height),
                ]
            })
            .map(|normal| {
                script_zoom.map_or(normal, |scale| {
                    ((normal as f32 / scale).floor() as u32).clamp(64, 512)
                })
            })
    }
}

pub fn viewport(camera: Camera, window: [u32; 2], room: [u32; 2], focus: [f32; 2]) -> [u32; 4] {
    viewport_zoom(camera, window, room, focus, None)
}

pub fn viewport_zoom(
    camera: Camera,
    window: [u32; 2],
    room: [u32; 2],
    focus: [f32; 2],
    script_zoom: Option<f32>,
) -> [u32; 4] {
    let [width, height] = camera.view_size(window, script_zoom);
    let width = width.min(room[0].max(1));
    let height = height.min(room[1].max(1));
    let axis = |center: f32, size: u32, extent: u32| {
        (center.round() as i64 - i64::from(size / 2))
            .clamp(0, i64::from(extent.saturating_sub(size))) as u32
    };
    [
        axis(focus[0], width, room[0]),
        axis(focus[1], height, room[1]),
        width,
        height,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_view_fits_small_rooms_and_stops_at_the_bottom() {
        assert_eq!(
            viewport(Camera::default(), [1920, 1080], [416, 256], [200., 246.]),
            [0, 0, 416, 256]
        );
        let camera = Camera {
            resolution: Some([320, 180]),
            ..Camera::default()
        };
        assert_eq!(
            viewport_zoom(camera, [1920, 1080], [416, 224], [360., 240.], Some(2.)),
            [256, 134, 160, 90]
        );
    }
}
