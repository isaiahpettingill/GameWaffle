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
4. Select a sprite definition in **Project**. Click the map to add an instance. You can also drag the definition to the map.
5. Select **Play room** to save and test the room.

Use **Grid** to show tile boundaries. Use **Collision** to show collision tiles. Use **Pan**, the zoom controls, and **Fit** to change the view. Use **Undo** to reverse a complete brush stroke or room edit. Use **Redo** to apply the change again.

| Task | Shortcut |
|---|---|
| Brush, eraser, rectangle, pick tile | B, E, R, I |
| Add instance, select instance, pan | P, V, H |
| Pan temporarily | Hold Space or drag with the middle mouse button |
| Remove the selected sprite | Delete |
| Undo and redo | Ctrl+Z and Ctrl+Shift+Z |
| Save the project | Ctrl+S |

On macOS, use Command in place of Ctrl.

### Use sprite instances

Add a sprite definition once. Add as many instances of that definition as necessary. Instances use the same art and script. Each instance has its own name, position, and game state.

Select an instance on the map or in the **Instances** panel. Set its player slot if it needs player controls. Open **Instance overrides** to change its starting health, animation, draw layer, or facing. Leave a field empty to use the definition value where applicable. Select **Open definition** or **Open script** to make a change for all instances.

To create an instance during play, use **Add instance of** in a Blockly script. Select the sprite definition. Set the X and Y offsets in pixels from the instance that runs the block. The new instance runs the **Start** event before its first physics step.

### Platformer and top-down settings

Set the room view in the **Room** panel. The platformer view uses gravity. In this view, **Move with D-pad** moves the sprite horizontally. Use **Jump** on a button event to make a grounded sprite jump.

The top-down view uses zero gravity. **Move with D-pad** moves the sprite on both axes. Diagonal and straight movement have the same speed. Attacks and facing-mode projectiles follow the last movement direction. By default, the room has solid edges. Lower sprites appear in front of higher sprites in the same visual layer.

Use a collidable layer for walls. The pathfinding block uses four-direction A* on the tile grid. Add separate behavior for platform jumps.

## Prepare assets and scripts

Use [demo/project.json](demo/project.json) as an example. Put art and audio files in the project's `assets/` directory. Studio rebuilds the saved project when these files change. Select **Rebuild assets** to start a rebuild manually.

- **Sprites.** Register the Aseprite file in **Assets**. Set the physics mode. Open **Collision filter** to set the category, mask, and group. Open **Appearance** to set the visual layer. Use **Blocks** to attach behavior to events. Studio saves each sprite script as CBOR. The compiler converts the blocks to operation codes and operands.
- **Tiles.** Set the project tile size to 8 × 8, 16 × 16, 24 × 24, or 32 × 32 pixels. Use the same size for all tile frames. Register the Aseprite file and select a tag. Each frame in the tag is a variant. Use `:animated:` or `:fluid:` to play the frames in sequence. Use `:mirror-x:`, `:mirror-y:`, or `:rot-90:` to transform the frames. Set tile properties in Studio.
- **Art.** Studio reads `.ase`, `.aseprite`, and `.png` files. It uses indexed palettes, transparency, frame times, and tag playback direction. Flatten native Aseprite tilemap layers and layers with non-normal blend modes before import.
- **Collision.** Enable collision on a room layer to use its tile physics. Available tile types include solid tiles, one-way platforms, ladders, breakable tiles, fluid zones, and rigid bodies. The compiler combines adjacent static collision tiles and makes a separate texture atlas for each room.
- **Audio.** Register WAV, Opus, Ogg Vorbis, or QOA files. Studio converts WAV to QOA by default. Use mono or stereo PCM or float32 WAV for this conversion. Clear the QOA option to keep the WAV file. Set music and ambient sound in the **Room** panel. Use **Play sound** in a sprite script for event sounds.

## Write game logic

Open **Blocks** and select **Logic**. The **Set** and **Get** blocks use a scope and a name. Select the same scope and name each time you use a value.

| Scope | Duration | Initial value |
|---|---|---|
| Local | One sprite instance | Zero |
| Global | One game session | Value in **Game**, or zero |
| Flag | One game session | Value in **Game**, or false |

A room change keeps the global variables and flags. It creates new local variables for the instances in the next room. A game reset restores the initial global variables and flags.

Connect number, variable, comparison, or button blocks to **If** and **While**. Use **Wait** to continue an event after a number of game ticks. The runtime also pauses long scripts after a fixed number of instructions. It continues those scripts on later ticks. A running event has one continuation for each instance. A second occurrence of the same event does not start another continuation.

Use integers for variable arithmetic. Use decimal constants for engine parameters such as movement speed. The runtime reports an error if a script divides by zero or exceeds the integer limit.

## Export a game

In Studio, open **Export** and select **Standalone web game**. Studio saves the project and downloads one HTML file. The file contains the game cartridge and the WebAssembly runtime. Open it in a browser or put it on a static web server. The game can run offline. On Android, use a browser that supports WebAssembly and use the touch controls.

Select **Cartridge** to download only the `.waffle` file. To play this file, select **Open cartridge** in the player.

After you build Studio, use these commands to export from the command line.

```sh
npm run cart -- path/to/project path/to/game.waffle
npm run export:web -- path/to/project path/to/game.html
npm run export:web -- path/to/game.waffle path/to/game.html
```

## Run a separate player

### Web

In Studio, select **Export → Web player** to get a separate copy. Run `npm run build:player` to build only the web player. Open `web-built/standalone/gamewaffle-player.html` in a browser. Select **Open cartridge**. The player can run offline.

### Desktop

Install CMake and the SDL3 build dependencies for your operating system. Run this command.

```sh
npm run build:native
```

Open the player in `web-built/native/`. Press **F1** to open a cartridge. You can also drop a cartridge on the window or give its path to the executable. Press **F2** to reset the game. Press **F3** to show or hide touch controls.

### Android

The native Android player uses SDL3. It includes a demo cartridge. Tap **Open** to select a different cartridge. Use the touch controls or connect a gamepad.

To build the APK, install Android NDK r27c, Android platform 35, Android build tools 35.0.0, JDK 21, CMake, and Ninja. Get the SDL 3.4.2 source files. Set `ANDROID_NDK_HOME`, `ANDROID_PLATFORM_JAR`, `ANDROID_BUILD_TOOLS`, `JAVA_HOME`, and `SDL_SOURCE` to the paths for these tools and files.

```sh
rustup target add aarch64-linux-android x86_64-linux-android
npm run cart
bash player/android/build.sh
```

Install `web-built/android/GameWaffle-Player.apk` on an Android device. Local builds use a debug key. Tagged releases use the release key. To include a different game, supply its cartridge path as the first argument to the build script.

### Render resolution

Open **Game**, then open **Display**. The player calculates the internal resolution from the available display area and the pixel zoom. It keeps the internal resolution between 128 × 128 and 512 × 512 pixels. The camera follows player 1 when the room is larger than the screen.

## Play with other players

Connect standard-mapped gamepads or use the keyboard. The players support four local slots. In the web player, set **Players** to the number of players. Compare the number of gamepads and player slots. If there are fewer gamepads, use the keyboard for the first slot. Gamepads use the other slots.

| Control | Player 1 keyboard | Player 2 keyboard (web) |
|---|---|---|
| D-pad | Arrow keys or W A S D | I J K L |
| A | Semicolon, Z, or left mouse button | N |
| B | Quote, X, or right mouse button | M |
| X | Space or C | Comma |
| Start | Enter | Period |

To play on a local network with the web player, start a host.

```sh
npm start -- --cart path/to/game.waffle --lan
```

On each device, open `http://HOST_IP:4871/player.html`. Select the number of players on that device. Then select **Join LAN**. All devices share the same room. The host assigns a total of four player slots.

## Use the runtime

Use the [SDK reference](docs/sdk.md) for cartridge layout, block source, and host APIs. Cartridges use format version 2.

LAN clients connect to `/lan` with WebSocket. Send a `join` message to request player slots. The host returns their slot numbers in `slots`. Send an `input` message with the button states for each client slot. The host sends `snapshot` messages at 30 Hz. Get the matching cartridge from `/lan.waffle`.

The Box2D Rust port uses its [upstream license](runtime/vendor/box2d-rs/LICENSE). GameWaffle uses a WebAssembly-compatible clock for the profiling timer.

## Edit a project

Open a folder to work on its source files. Use **Assets → Import image or sound** to add a PNG, Aseprite file, or sound. Select **Add sprite** or **Add tile** to use the image. A PNG supplies one frame.

Select **Export → Editable project** to copy the project to a single `.waffleproj` file. Studio keeps its files in a virtual filesystem. A save replaces the archive. Use this command to open an archive or a folder after you build Studio.

```sh
node packaging/studio.mjs path/to/game.waffleproj
```

Select **Export → Cartridge** to distribute a game. The cartridge contains compiled instructions and room atlases. The player checks an Ed25519 signature before it runs the game. The public key travels with the cartridge. A third party can build and sign a different cartridge.

## Edit on Android

Extract `GameWaffle-Android-Studio.tar.gz` in Termux. Install Node.js 24 or later. Run the following command from the extracted directory. Studio opens in the local browser. Use **Project**, **Editor**, and **Settings** to switch panels on a narrow screen.

```sh
node packaging/studio.mjs
```

## Connect rooms

Select **World**. Select a room and an exit. Select a destination. Use **Once per save** for a fixed random choice in each new game. Use **On each crossing** to draw again. Add a required flag to lock an exit.

For a continuous crossing, connect opposite edges in both directions. Select **Fixed** and **Connect opposite edges** on both exits. Use equal edge lengths. The camera shows terrain from the next room before the player crosses. Sprites and physics start when the player enters the next room.

Use a camera block to follow a sprite, show a position, or return to player 1. Normal enemy tick scripts stop outside the camera and player activity areas. Enable **Assets → Combat → Run scripts off camera** for a boss.

## Items, dialogue, and saves

Use the **Items** blocks to give, remove, or count items in the party inventory. Use **Dialogue & HUD** to show a counter or a message. Press A to advance dialogue. In the Top-down Courtyard, walk up to collect the key.

To use a custom bitmap font, import a 96 × 48 pixel sheet. Arrange ASCII characters 32 through 127 in 16 columns and 6 rows. Each cell has 6 × 8 pixels. Select the font in **Game → Display**.

On desktop, press **F4** to map a controller. Press each control in order. The player saves the mapping for that controller model. Press **F5** to save, **F6** to select a slot, or **F9** to load. Android has **Pad**, **Save**, and **Load** controls. The web player has a slot selector.

Each save includes the current room, player positions, global variables, flags, inventory, counters, and exit random state. Use the **Load saved game** event to restore other scene behavior. Set `saveId` in the project to keep its save identity when you rename a game.

## Build release packages

Pull requests build a Linux AppImage, a Windows NSIS installer, an Android player APK, and an Android Studio archive. Desktop packages include Studio and the SDL3 player. To start only the Linux player, use `GameWaffle-x86_64.AppImage --player`.

Run this command from the checkout with Bash, Python 3, the JDK, and an authenticated GitHub CLI. Use a new path. Keep the key and its password for future Android updates.

```sh
bash packaging/signing-key.sh "$HOME/GameWaffle-release.p12"
```

Push a version tag such as `v0.1.0` to publish a GitHub Release. Tagged builds require the Android signing secret. GitHub issues build provenance for the release files.

GameWaffle uses the [0BSD license](LICENSE).

## Add particle effects

Select a sprite in **Assets → Particles**. Select an effect and set the rate in particles per second. Each instance has its own emitter. The presets include sparks, dust, smoke, flame, bubbles, rain, and snow.

Use **Particles** in Blockly for bursts, continuous effects, and stop commands. Emitted particles finish their movement after the source disappears. The runtime limits a room to 2,048 live particles and 256 new particles per tick. Particles use a separate random sequence from room connections.
