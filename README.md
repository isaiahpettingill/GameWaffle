# GameWaffle

GameWaffle is a sprite game engine with a Svelte and Blockly editor and a Rust runtime. It builds individual games into `.waffle` cartridges. The player runs the same Rust code in a desktop or Android browser. The LAN host runs the simulation on the host computer.

## Build and run

Install Node.js 22.12 or later, Rust with the WebAssembly target, and the matching wasm-bindgen CLI.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
npm run build
npm start
```

Open [GameWaffle Studio](http://localhost:4871). Select **Play** to test Basalt Works, the included demo. **Export cartridge** downloads the current saved project.

`web-built/standalone/player.html` is a self-contained offline player with the demo built in. Open it in a browser and use **Open cartridge** to play another `.waffle` file. On Android, open the hosted player in a browser to play with the touch controls. Use the offline file on browsers that permit local HTML and WebAssembly.

```sh
npm start -- --project path/to/project
npm run cart -- path/to/project path/to/game.waffle
npm start -- --cart path/to/game.waffle --lan
```

With `--lan`, open `http://HOST_IP:4871/player.html` from the other devices, select a local player count, then select **Join LAN**. One host supports four slots total across browsers, including multiple local players on one device. Only the host computer can use the editor API. One simulation and room are shared across the session.

| Control | Player 1 keyboard | Player 2 keyboard |
|---|---|---|
| D-pad | Arrows or W A S D | I J K L |
| A | Z or Space | N |
| B | X | M |
| X | C | Comma |
| Start | Enter | Period |

Connect standard-mapped gamepads for up to four couch players. Change the player count to match the number of players. A complete set of gamepads uses slots in controller order. With fewer gamepads, the keyboard uses the first slot and gamepads fill the following slots. In Basalt Works, A jumps, B attacks, X fires, and Start enters the Cooling Vault.

## Author a game

Use [demo/project.json](demo/project.json) as a starting point. The Studio works with a project directory on the host computer. Place source art and audio under `assets/`. Studio rebuilds the saved project when those files change. Use **Rebuild assets** to refresh on demand. Studio reads `.ase` and `.aseprite` directly. It preserves indexed palettes, transparency, frame timings, tag order, animation direction, and supported layers. Flatten native Aseprite tilemap layers and layers with non-normal blend modes before importing.

- **Sprites.** Register a sprite source in **Assets**, set physics and visual order, then add behavior under **Blocks**. GameWaffle writes one CBOR file per sprite. The compiler replaces visual blocks with compact opcode and operand arrays. Rooms can assign sprite instances to controller slots 1–4. Sprite density, mass override, elasticity, friction, gravity, collision category, mask, and group map to the Rust Box2D port.
- **Tiles.** Register a source and an Aseprite tag, or add all tags in a source to the global tile registry. Each tag is a set of variants. A tile with `:animated:` or `:fluid:` plays the sequence. Append `:mirror-x:`, `:mirror-y:`, or `:rot-90:` to a tag to transform its frames. You can select a variant by zero-based index while painting. Set gameplay and physics attributes in the editor.
- **Rooms.** Paint multiple visual layers and enable collision per layer. Static tile graphics bake into layer images and adjacent static collision fixtures merge. Ladders, one-way platforms, breakables, fluid zones, animated tiles, and rigid bodies retain per-tile behavior where needed. The compiler builds a separate atlas for each room using its references. Add sprites and choose music and ambient sound in the room inspector.
- **Combat and movement.** Event stacks can deal attack-box damage, receive damage and contact events, play sounds, and fire projectiles in facing, position, trajectory intercept, or heat-seeking mode. The pathfinding block uses four-direction A* for a grid walk or a flying sprite. Platform jumps require separate behavior.
- **Audio.** Register WAV, Opus, Ogg Vorbis, or QOA. WAV imports compress to QOA by default. Studio can retain the original WAV. Use mono or stereo PCM or float32 WAV for QOA encoding. The player uses browser decoding for the original formats.

## Cartridge and runtime

Format version 1 begins with `47 57 41 46 00 01` in hex, followed by CBOR. It carries the starting room, compiled rooms, sprite bytecode, PNG atlases, and audio. A Rust host can open the same bytes with `Runtime::from_cartridge` in `runtime/`. Call `step` at 60 Hz with four input objects. Snapshots contain visible actor transforms, sound cues, and structured damage and contact events. Rendering, controller polling, and audio output are in the browser player.

LAN clients connect to `/lan` over WebSocket. A `join` message requests a number of local players. The host returns their global `slots`. An `input` message sends the current buttons for each assigned slot. The host publishes `snapshot` messages at 30 Hz. Fetch the matching cartridge from `/lan.waffle`.

The bundled Box2D Rust port retains its upstream license in [runtime/vendor/box2d-rs/LICENSE](runtime/vendor/box2d-rs/LICENSE). GameWaffle changes its profiling timer to use a WebAssembly-compatible clock.
