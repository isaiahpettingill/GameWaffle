use gamewaffle_runtime::{Input, Runtime};
use std::{hint::black_box, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let files = std::env::args().skip(1).collect::<Vec<_>>();
    let files = if files.is_empty() {
        vec!["web-built/demo.waffle".to_owned()]
    } else {
        files
    };
    let inputs = [
        Input::from_bits(16),
        Input::default(),
        Input::default(),
        Input::default(),
    ];
    for file in files {
        let bytes = std::fs::read(&file)?;
        for (label, view) in [("simulation", false), ("simulation + native view", true)] {
            let mut times = Vec::new();
            for _ in 0..5 {
                let mut runtime = Runtime::from_cartridge(&bytes, None)?;
                runtime.set_seed(1);
                for _ in 0..2_000 {
                    runtime.step_inputs(inputs)?;
                }
                let start = Instant::now();
                for _ in 0..30_000 {
                    runtime.step_inputs(inputs)?;
                    if view {
                        black_box(runtime.view());
                    }
                }
                times.push(start.elapsed().as_secs_f64() * 1e6 / 30_000.0);
            }
            times.sort_by(f64::total_cmp);
            println!("{file} · {label}: {:.2} µs/tick (median)", times[2]);
        }
    }
    Ok(())
}
