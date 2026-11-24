use super::{Mode, Runtime};

const TILE_TOLERANCE: f32 = 2.0;

fn spans_overlap(a: [f32; 2], b: [f32; 2]) -> bool {
    a[0] < b[1] && b[0] < a[1]
}

fn touches(entity: [f32; 4], tile: [f32; 4], side: &str) -> bool {
    let [l, t, r, b] = entity;
    let [tl, tt, tr, tb] = tile;
    let horizontal = spans_overlap([l, r], [tl, tr]);
    let vertical = spans_overlap([t, b], [tt, tb]);
    let close = |left: f32, right: f32| (left - right).abs() <= TILE_TOLERANCE;
    match side {
        "left" => vertical && close(r, tl),
        "right" => vertical && close(l, tr),
        "top" => horizontal && close(b, tt),
        "bottom" => horizontal && close(t, tb),
        "any" => {
            (horizontal && (vertical || close(t, tb) || close(b, tt)))
                || (vertical && (close(l, tr) || close(r, tl)))
        }
        _ => false,
    }
}

fn tile_mode(mode: Mode, kind: &str) -> bool {
    match kind {
        "any" => true,
        "solid" => matches!(
            mode,
            Mode::Static | Mode::Dynamic | Mode::Kinematic | Mode::OneWay | Mode::Breakable
        ),
        "static" => mode == Mode::Static,
        "dynamic" => mode == Mode::Dynamic,
        "kinematic" => mode == Mode::Kinematic,
        "one_way" => mode == Mode::OneWay,
        "breakable" => mode == Mode::Breakable,
        "fluid" => mode == Mode::Fluid,
        "ladder" => mode == Mode::Ladder,
        "sensor" => mode == Mode::Sensor,
        "decorative" => mode == Mode::None,
        _ => false,
    }
}

impl Runtime {
    fn entity_bounds(&self, id: u32) -> Option<[f32; 4]> {
        let actor = self.entity(id)?;
        let [l, t, r, b] = actor.collider_bounds;
        let [x, y] = [actor.p.x, actor.p.y];
        Some([x + l, y + t, x + r, y + b])
    }

    pub(super) fn camera_sensing(&self, id: u32, op: u16, side: &str) -> bool {
        let Some([l, t, r, b]) = self.entity_bounds(id) else {
            return false;
        };
        let [left, top, right, bottom] = if op == 2 {
            let room = &self.game.rooms[&self.room];
            [0., 0., room.cols as f32 * room.size, room.height]
        } else {
            let [x, y, w, h] = self.camera_viewport().map(|pixel| pixel as f32);
            [x, y, x + w, y + h]
        };
        if op == 1 {
            return spans_overlap([l, r], [left, right]) && spans_overlap([t, b], [top, bottom]);
        }
        match side {
            "left" => l <= left,
            "right" => r >= right,
            "top" => t <= top,
            "bottom" => b >= bottom,
            "any" => l <= left || r >= right || t <= top || b >= bottom,
            _ => false,
        }
    }

    pub(super) fn touching_tiles(&self, id: u32, filter: &str, side: &str, by_kind: bool) -> bool {
        let Some(bounds) = self.entity_bounds(id) else {
            return false;
        };
        let [l, t, r, b] = bounds;
        let room = &self.game.rooms[&self.room];
        let matches = |mark: &super::model::TileMark| {
            if by_kind {
                tile_mode(mark.mode, filter)
            } else {
                mark.tile == filter
            }
        };
        let size = room.size;
        let low = |pixel: f32| ((pixel - TILE_TOLERANCE) / size).floor().max(0.) as usize;
        let high = |pixel: f32, count: usize| {
            (((pixel + TILE_TOLERANCE) / size).floor() as isize).min(count as isize - 1)
        };
        let [x0, y0] = [low(l), low(t)];
        let [x1, y1] = [high(r, room.cols), high(b, room.rows)];
        if !room.tile_cells.is_empty() && x1 >= x0 as isize && y1 >= y0 as isize {
            for y in y0..=y1 as usize {
                for x in x0..=x1 as usize {
                    if let Some(cell) = room.tile_cells.get(&(y * room.cols + x))
                        && cell.iter().any(matches)
                        && touches(
                            bounds,
                            [
                                x as f32 * size,
                                y as f32 * size,
                                (x + 1) as f32 * size,
                                (y + 1) as f32 * size,
                            ],
                            side,
                        )
                    {
                        return true;
                    }
                }
            }
        }
        self.tile_entities.iter().any(|&tile| {
            if tile == id {
                return false;
            }
            let actor = &self.actors[&tile];
            let [x, y] = [actor.p.x, actor.p.y];
            let [l, t, r, b] = actor.collider_bounds;
            actor.active()
                && actor.tile_mark.as_ref().is_some_and(matches)
                && touches(bounds, [x + l, y + t, x + r, y + b], side)
        })
    }
}
