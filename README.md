# GameWaffle

Use GameWaffle Studio to make 2D sprite games. Use the Room editor to make maps. Use Blockly to make sprite scripts. The Rust runtime uses Box2D for physics.

## Build and start Studio

Install Node.js 22.12 or later and Rust. Then run these commands from the repository directory.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
npm run build
npm start
```

Open [GameWaffle Studio](http://localhost:4871). Select **Play game** to start the Basalt Works demo. Select **Top-down Courtyard**, then select **Play room** to try the top-down controls.

To open a different project, run this command.

```sh
npm start -- --project path/to/project
```

## Build a room

1. In **Project**, select **New room** (+). Select **New platformer room** or **New top-down room**.
2. Select the layer that you want to edit. Use **Terrain** or **Walls** for collision. Use **Background** or **Ground** for decoration.
3. Select a tile from the palette. Select **Brush**. Drag across the map to paint tiles. Use **Rectangle** to fill an area. Use **Pick tile** to select a tile from the map.
4. Select **Place sprite**. Select a sprite and, if necessary, a player slot. Click the map to place the sprite. Use **Select sprite** to move or remove it.
5. Select **Play room** to save and test the room.

Use **Grid** to show tile boundaries. Use **Collision** to show collision tiles. Use **Pan**, the zoom controls, and **Fit** to change the view. Use **Undo** to reverse a complete brush stroke or room edit. Use **Redo** to apply the change again.

| Task | Shortcut |
|---|---|
| Brush, eraser, rectangle, pick tile | B, E, R, I |
| Place sprite, select sprite, pan | P, V, H |
| Pan temporarily | Hold Space or drag with the middle mouse button |
| Remove the selected sprite | Delete |
| Undo and redo | Ctrl+Z and Ctrl+Shift+Z |
| Save the project | Ctrl+S |

On macOS, use Command in place of Ctrl.

### Platformer and top-down settings

Set the room view in the **Room** panel. The platformer view uses gravity. In this view, **Move with D-pad** moves the sprite horizontally. Use **Jump** on a button event to make a grounded sprite jump.

The top-down view uses zero gravity. **Move with D-pad** moves the sprite on both axes. Diagonal and straight movement have the same speed. Attacks and facing-mode projectiles follow the last movement direction. By default, the room has solid edges. Lower sprites appear in front of higher sprites in the same visual layer.

Use a collidable layer for walls. The pathfinding block uses four-direction A* on the tile grid. Add separate behavior for platform jumps.

## Prepare assets and scripts

Use [demo/project.json](demo/project.json) as an example. Put art and audio files in the project's `assets/` directory. Studio rebuilds the saved project when these files change. Select **Rebuild assets** to start a rebuild manually.

- **Sprites.** Register the Aseprite file in **Assets**. Set the physics mode, collision filter, and visual layer. Use **Blocks** to attach behavior to events. Studio saves each sprite script as CBOR. The compiler converts the blocks to operation codes and operands.
- **Tiles.** Register the Aseprite file and select a tag. Each frame in the tag is a variant. Use `:animated:` or `:fluid:` to play the frames in sequence. Use `:mirror-x:`, `:mirror-y:`, or `:rot-90:` to transform the frames. Set tile properties in Studio.
- **Art.** Studio reads `.ase` and `.aseprite` files. It uses indexed palettes, transparency, frame times, and tag playback direction. Flatten native Aseprite tilemap layers and layers with non-normal blend modes before import.
- **Collision.** Enable collision on a room layer to use its tile physics. Available tile types include solid tiles, one-way platforms, ladders, breakable tiles, fluid zones, and rigid bodies. The compiler combines adjacent static collision tiles and makes a separate texture atlas for each room.
- **Audio.** Register WAV, Opus, Ogg Vorbis, or QOA files. Studio converts WAV to QOA by default. Use mono or stereo PCM or float32 WAV for this conversion. Clear the QOA option to keep the WAV file. Set music and ambient sound in the **Room** panel. Use **Play sound** in a sprite script for event sounds.

## Export a game

In Studio, open **Export** and select **Standalone web game**. Studio saves the project and downloads one HTML file. The file contains the game cartridge and the WebAssembly runtime. Open it in a browser or put it on a static web server. The game can run offline. On Android, use a browser that supports WebAssembly and use the touch controls.

Select **Cartridge** to download only the `.waffle` file. To play this file, select **Open cartridge** in the player.

After you build Studio, use these commands to export from the command line.

```sh
npm run cart -- path/to/project path/to/game.waffle
npm run export:web -- path/to/project path/to/game.html
npm run export:web -- path/to/game.waffle path/to/game.html
```

## Play with other players

Connect standard-mapped gamepads or use the keyboard. The player supports four local slots. Set **Players** to the number of players. Compare the number of gamepads and player slots. If there are fewer gamepads, use the keyboard for the first slot. Gamepads use the other slots.

| Control | Player 1 keyboard | Player 2 keyboard |
|---|---|---|
| D-pad | Arrow keys or W A S D | I J K L |
| A | Z or Space | N |
| B | X | M |
| X | C | Comma |
| Start | Enter | Period |

To play on a local network, start a host.

```sh
npm start -- --cart path/to/game.waffle --lan
```

On each device, open `http://HOST_IP:4871/player.html`. Select the number of players on that device. Then select **Join LAN**. All devices share the same room. The host assigns a total of four player slots.

## Use the runtime

Cartridge format version 1 starts with the hexadecimal bytes `47 57 41 46 00 01`. The CBOR data after these bytes contains room data, sprite operation codes, PNG atlases, and audio.

Call `Runtime::from_cartridge` in Rust to load a cartridge. Call `step` at 60 Hz with four input objects. Each snapshot supplies sprite transforms, sound events, damage events, and contact events. The browser player displays the room, reads the controls, and plays sound.

LAN clients connect to `/lan` with WebSocket. Send a `join` message to request player slots. The host returns their slot numbers in `slots`. Send an `input` message with the button states for each client slot. The host sends `snapshot` messages at 30 Hz. Get the matching cartridge from `/lan.waffle`.

The Box2D Rust port uses its [upstream license](runtime/vendor/box2d-rs/LICENSE). GameWaffle uses a WebAssembly-compatible clock for the profiling timer.
