use crate::Error;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub enum Network {
    Host(Vec<TcpStream>),
    Guest(TcpStream),
}
fn configure(stream: &TcpStream) -> std::io::Result<()> {
    stream.set_nodelay(true)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))
}
impl Network {
    pub fn connect(
        path: &Path,
        address: &str,
        guests: Option<usize>,
    ) -> Result<(Self, u32), Error> {
        let mut file = File::open(path)?;
        file.seek(SeekFrom::End(-96))?;
        let mut signature = [0; 96];
        file.read_exact(&mut signature)?;
        if let Some(n) = guests {
            if !(1..=3).contains(&n) {
                return Err("Select one to three remote players".into());
            }
            let listener = TcpListener::bind(address)?;
            let mut peers = Vec::new();
            let seed = SystemTime::now()
                .duration_since(UNIX_EPOCH)?
                .subsec_nanos()
                .max(1);
            eprintln!("Waiting for {n} players on {}", listener.local_addr()?);
            while peers.len() < n {
                let (mut peer, _) = listener.accept()?;
                configure(&peer)?;
                let mut other = [0; 96];
                if peer.read_exact(&mut other).is_ok() && other == signature {
                    peers.push(peer);
                }
            }
            for peer in &mut peers {
                peer.write_all(&seed.to_le_bytes())?;
            }
            Ok((Self::Host(peers), seed))
        } else {
            let mut peer = TcpStream::connect(address)?;
            configure(&peer)?;
            peer.write_all(&signature)?;
            peer.set_read_timeout(Some(Duration::from_secs(120)))?;
            let mut seed = [0; 4];
            peer.read_exact(&mut seed)?;
            configure(&peer)?;
            Ok((Self::Guest(peer), u32::from_le_bytes(seed)))
        }
    }
    pub fn step(&mut self, local: [bool; 8]) -> Result<[[bool; 8]; 4], Error> {
        let bits = local
            .iter()
            .enumerate()
            .fold(0, |v, (i, b)| v | (u8::from(*b) << i));
        let mut frame = [0; 4];
        match self {
            Self::Guest(peer) => {
                peer.write_all(&[bits])?;
                peer.read_exact(&mut frame)?;
            }
            Self::Host(peers) => {
                frame[0] = bits;
                for (i, peer) in peers.iter_mut().enumerate() {
                    peer.read_exact(&mut frame[i + 1..i + 2])?;
                }
                for peer in peers {
                    peer.write_all(&frame)?;
                }
            }
        }
        Ok(frame.map(|bits| std::array::from_fn(|i| bits & (1 << i) != 0)))
    }
}
