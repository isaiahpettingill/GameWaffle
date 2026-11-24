use crate::model::Room;
use crate::physics::Vec2;
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashSet},
};

pub fn waypoint(room: &Room, from: Vec2, to: Vec2, blocked: &HashSet<usize>) -> Option<Vec2> {
    let index = |p: Vec2| {
        let x = (p.x / room.size).floor().clamp(0.0, (room.cols - 1) as f32) as usize;
        let y = (p.y / room.size).floor().clamp(0.0, (room.rows - 1) as f32) as usize;
        y * room.cols + x
    };
    let origin = index(from);
    let goal = index(to);
    if origin == goal {
        return Some(to);
    }
    let heuristic = |n: usize| {
        n.abs_diff(n / room.cols * room.cols + goal % room.cols)
            + (n / room.cols).abs_diff(goal / room.cols)
    };
    let mut queue = BinaryHeap::new();
    let mut distance = vec![usize::MAX; room.cols * room.rows];
    let mut parents = vec![usize::MAX; distance.len()];
    queue.push(Reverse((heuristic(origin), 0, origin)));
    distance[origin] = 0;
    while let Some(Reverse((_, cost, here))) = queue.pop() {
        if here == goal {
            let mut next = goal;
            while parents[next] != origin {
                next = parents[next];
            }
            return Some(Vec2::new(
                (next % room.cols) as f32 * room.size + room.size / 2.0,
                (next / room.cols) as f32 * room.size + room.size / 2.0,
            ));
        }
        if distance[here] != cost {
            continue;
        }
        let x = here % room.cols;
        let y = here / room.cols;
        let neighbors = [
            x.checked_sub(1).map(|_| here - 1),
            (x + 1 < room.cols).then_some(here + 1),
            y.checked_sub(1).map(|_| here - room.cols),
            (y + 1 < room.rows).then_some(here + room.cols),
        ];
        for next in neighbors.into_iter().flatten() {
            if blocked.contains(&next) || distance[next] <= cost + 1 {
                continue;
            }
            parents[next] = here;
            distance[next] = cost + 1;
            queue.push(Reverse((cost + 1 + heuristic(next), cost + 1, next)));
        }
    }
    None
}

/// Search from one supported tile to another. Sample each ballistic arc for clearance.
pub fn platform_move(
    room: &Room,
    from: Vec2,
    to: Vec2,
    blocked: &HashSet<usize>,
    speed: f32,
    gravity: f32,
) -> Vec2 {
    use std::collections::VecDeque;
    let cell = |p: Vec2| {
        (
            (p.x / room.size).floor() as i32,
            (p.y / room.size).floor() as i32,
        )
    };
    let open = |x: i32, y: i32| {
        x >= 0
            && y >= 0
            && x < room.cols as i32
            && y < room.rows as i32
            && !blocked.contains(&(y as usize * room.cols + x as usize))
    };
    let stand = |x: i32, y: i32| open(x, y) && !open(x, y + 1);
    let origin = cell(from);
    let target = cell(to);
    let mut queue = VecDeque::from([(origin, Vec2::ZERO)]);
    let mut seen = HashSet::from([origin]);
    let mut best = (
        origin.0.abs_diff(target.0) + origin.1.abs_diff(target.1),
        Vec2::ZERO,
    );
    while let Some(((x, y), first)) = queue.pop_front() {
        if seen.len() > 512 {
            break;
        }
        for sign in [-1, 1] {
            for jump in [false, true] {
                let vx = speed * sign as f32;
                let vy = if jump { -8. } else { 0. };
                let velocity = Vec2::new(vx, vy);
                let initial = if (x, y) == origin { velocity } else { first };
                let mut last = (x, y);
                for tick in 1..=90 {
                    let t = tick as f32 / 60.;
                    let px = x as f32 + 0.5 + vx * t * super::PPM / room.size;
                    let py =
                        y as f32 + 0.99 + (vy * t + 0.5 * gravity * t * t) * super::PPM / room.size;
                    let pos = (px.floor() as i32, py.floor() as i32);
                    if !jump && last == (x, y) && pos.0 == x {
                        continue;
                    }
                    let landing = if !jump && stand(pos.0, y) && pos.0 != x {
                        Some((pos.0, y))
                    } else if vy + gravity * t >= 0.
                        && !open(pos.0, pos.1)
                        && stand(pos.0, pos.1 - 1)
                    {
                        Some((pos.0, pos.1 - 1))
                    } else {
                        None
                    };
                    if let Some(p) = landing {
                        if seen.insert(p) {
                            let dist = p.0.abs_diff(target.0) + p.1.abs_diff(target.1);
                            if dist == 0 {
                                return initial;
                            }
                            if dist < best.0 {
                                best = (dist, initial);
                            }
                            queue.push_back((p, initial));
                        }
                        break;
                    }
                    if !open(pos.0, pos.1) {
                        break;
                    }
                    last = pos;
                }
            }
        }
    }
    best.1
}
