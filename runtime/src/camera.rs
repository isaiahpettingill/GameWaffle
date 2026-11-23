use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(default)]
pub struct Camera {
    pub min_width: u32,
    pub min_height: u32,
    pub max_width: u32,
    pub max_height: u32,
    pub zoom: u32,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            min_width: 160,
            min_height: 144,
            max_width: 512,
            max_height: 512,
            zoom: 2,
        }
    }
}

pub fn viewport(camera: Camera, window: [u32; 2], room: [u32; 2], focus: [f32; 2]) -> [u32; 4] {
    let zoom = camera.zoom.max(1);
    let width = (window[0] / zoom).clamp(camera.min_width, camera.max_width);
    let height = (window[1] / zoom).clamp(camera.min_height, camera.max_height);
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
