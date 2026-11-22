use crate::model::Room;
use box2d_rs::b2_math::B2vec2;
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashSet},
};

pub fn waypoint(room: &Room, from: B2vec2, to: B2vec2, blocked: &HashSet<usize>) -> Option<B2vec2> {
    let index = |p: B2vec2| {
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
            return Some(B2vec2::new(
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
