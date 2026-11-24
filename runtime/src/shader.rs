use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShaderKind {
    None,
    Hd,
    Ripple,
    Tint,
    Scanlines,
    Grid,
    Vignette,
    Fog,
    Volumetric,
    LensFlare,
    Snow,
    Rain,
    Wind,
}

impl ShaderKind {
    pub(crate) fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "none" => Self::None,
            "hd" => Self::Hd,
            "ripple" => Self::Ripple,
            "tint" => Self::Tint,
            "scanlines" => Self::Scanlines,
            "grid" => Self::Grid,
            "vignette" => Self::Vignette,
            "fog" => Self::Fog,
            "volumetric" => Self::Volumetric,
            "lens_flare" => Self::LensFlare,
            "snow" => Self::Snow,
            "rain" => Self::Rain,
            "wind" => Self::Wind,
            _ => return None,
        })
    }

    pub fn masks(self) -> &'static [(&'static str, &'static str)] {
        match self {
            Self::Fog => &[("shader/fog/screen", "screen")],
            Self::Volumetric => &[("shader/volumetric/screen", "screen")],
            Self::LensFlare => &[("shader/lens_flare/screen", "screen")],
            Self::Tint => &[("shader/tint/screen", "screen")],
            Self::Vignette => &[("shader/vignette/screen", "screen")],
            Self::Scanlines => &[("shader/scanlines/rows", "rows")],
            Self::Grid => &[
                ("shader/grid/rows", "rows"),
                ("shader/grid/columns", "columns"),
            ],
            _ => &[],
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RoomShader {
    pub kind: ShaderKind,
    pub strength: u8,
}

impl RoomShader {
    pub fn hd(self) -> u8 {
        if self.kind == ShaderKind::Hd {
            self.strength
        } else {
            0
        }
    }

    pub fn ripple(self) -> Option<[u8; 3]> {
        (self.kind == ShaderKind::Ripple && self.strength > 0).then_some([
            (u16::from(self.strength) * 12).div_ceil(100) as u8,
            32,
            1,
        ])
    }
}

pub const MAX_SHADER_PASSES: usize = 8;
pub const MAX_SHADER_WORDS: usize = 64;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ShaderPass {
    pub shader: String,
    pub uniforms: Vec<u32>,
}

pub(crate) fn valid_pipeline(passes: &[ShaderPass]) -> bool {
    passes.len() <= MAX_SHADER_PASSES
        && passes.iter().all(|pass| {
            !pass.shader.is_empty() && pass.shader.len() <= 96 && pass.uniforms.len() <= MAX_SHADER_WORDS
        })
}
