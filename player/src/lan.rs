use crate::Error;
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const PROTOCOL: &[u8; 6] = b"GWLAN\x01";
type Frame = [[bool; 8]; 4];

enum Network {
    Host(Vec<TcpStream>),
    Guest(TcpStream),
}
pub struct Session {
    connected: u8,
    inputs: SyncSender<[bool; 8]>,
    frames: Receiver<Result<Frame, String>>,
    pending: bool,
}

impl Session {
    pub fn connect(path: &Path, address: &str, guests: Option<usize>) -> Result<(Self, u32), Error> {
        let (mut network, seed, connected) = Network::connect(path, address, guests)?;
        let (inputs, requests) = mpsc::sync_channel(1);
        let (results, frames) = mpsc::sync_channel(1);
        std::thread::Builder::new().name("gamewaffle-lan".into()).spawn(move || {
            while let Ok(input) = requests.recv() {
                let result = network.step(input).map_err(|error| error.to_string());
                let stop = result.is_err();
                if results.send(result).is_err() || stop {
                    break;
                }
            }
        })?;
        Ok((Self { connected, inputs, frames, pending: false }, seed))
    }

    pub fn connected(&self) -> u8 {
        self.connected
    }

    /// There is at most one input outstanding, so the simulation advances in lockstep.
    pub fn request(&mut self, input: [bool; 8]) -> Result<bool, Error> {
        if self.pending {
            return Ok(false);
        }
        self.inputs.try_send(input).map_err(|_| "LAN input worker stopped")?;
        self.pending = true;
        Ok(true)
    }

    pub fn poll(&mut self) -> Result<Option<Frame>, Error> {
        match self.frames.try_recv() {
            Ok(frame) => {
                self.pending = false;
                Ok(Some(frame?))
            }
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => Err("LAN input worker stopped".into()),
        }
    }
}
fn configure(stream: &TcpStream) -> std::io::Result<()> {
    stream.set_nodelay(true)?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    stream.set_write_timeout(Some(Duration::from_secs(10)))
}
impl Network {
    fn connect(
        path: &Path,
        address: &str,
        guests: Option<usize>,
    ) -> Result<(Self, u32, u8), Error> {
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
                let mut protocol = [0; PROTOCOL.len()];
                let mut other = [0; 96];
                if peer.read_exact(&mut protocol).is_ok()
                    && &protocol == PROTOCOL
                    && peer.read_exact(&mut other).is_ok()
                    && other == signature
                {
                    peers.push(peer);
                }
            }
            let connected = (1 << (n + 1)) - 1;
            for peer in &mut peers {
                peer.write_all(&seed.to_le_bytes())?;
                peer.write_all(&[connected])?;
            }
            Ok((Self::Host(peers), seed, connected))
        } else {
            let mut peer = TcpStream::connect(address)?;
            configure(&peer)?;
            peer.write_all(PROTOCOL)?;
            peer.write_all(&signature)?;
            peer.set_read_timeout(Some(Duration::from_secs(120)))?;
            let mut seed = [0; 4];
            peer.read_exact(&mut seed)?;
            let mut connected = [0];
            peer.read_exact(&mut connected)?;
            if !matches!(connected[0], 3 | 7 | 15) {
                return Err("Invalid LAN player roster".into());
            }
            configure(&peer)?;
            Ok((Self::Guest(peer), u32::from_le_bytes(seed), connected[0]))
        }
    }
    fn step(&mut self, local: [bool; 8]) -> Result<Frame, Error> {
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
