# GameWaffle

Use GameWaffle Studio to make 2D sprite games. Use the Room editor to make maps. Use Blockly to make sprite scripts. The Rust runtime uses Rapier2D for physics.

## Build and start Studio

Install Node.js 22.12 or later and Rust. Then run these commands from the repository directory.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
npm run build
npm start
```

Studio opens a Tauri window. Select **New Project**, enter a game name, and choose a first room. Studio generates a folder name from the game title. Use **Change…** to choose another location. Select **Open Project** to browse for a project folder or a `.waffleproj` file. Studio opens your most recent project at startup. Use **File → Project Manager** to open another recent project. Select **Open Basalt Works example** to open a copy of the demo. On Linux, install the WebKitGTK 4.1 and GTK 3 development packages before building Studio. Use `npm run studio:browser` for the browser edition. Select **Top-down Courtyard**, then select **Play room** to try the top-down controls.

To open a different project, run this command.

```sh
npm start -- --project path/to/project
```

## Build a room

1. In **Project**, select **New room** (+). Select **New platformer room** or **New top-down room**.
2. Select the layer that you want to edit. Use **Terrain** or **Walls** for collision. Use **Background** or **Ground** for decoration.
3. Select a tile from the palette. Select **Brush**. Drag with the left mouse button to paint. Drag with the right mouse button to erase tiles on the active layer. Use **Rectangle** to fill an area. Use **Pick tile** to select a tile from the map.
4. Select an entity in **Project**. Click the map to add an instance. You can also drag the definition to the map.
5. Select **Play room** to save and test the room.

Use **Grid** to show tile boundaries. Use **Collision** to show collision tiles. Use **Pan**, the zoom controls, and **Fit** to change the view. Use **Undo** to reverse a complete brush stroke or room edit. Use **Redo** to apply the change again.

| Task | Shortcut |
|---|---|
| Brush, eraser, rectangle, pick tile | B, E, R, I |
| Place entity, select instance, pan | P, V, H |
| Pan temporarily | Hold Space or drag with the middle mouse button |
| Remove the selected sprite | Delete |
| Undo and redo | Ctrl+Z and Ctrl+Shift+Z |
| Save the project | Ctrl+S |

On macOS, use Command in place of Ctrl.

### Use entity instances

Add an entity once. Add as many instances of that definition as necessary. Instances use the same art and script. Each instance has its own name, position, and game state.

Select a placed entity on the map or in **Placed entities**. Set its position and controller assignment there. Expand **Starting values** to change its starting health, animation, draw layer, or facing. Leave a field empty to use the type’s default. Use **Edit type** or **Open script** to change what all placements share.

To create an instance during play, use **Create instance of** in a Blockly script. Select the entity. Set the X and Y offsets in pixels from the instance that runs the block. The new instance runs the **Start** event before its first physics step.

### Platformer and top-down settings

Set the room view in the **Room** panel. The platformer view uses gravity. In this view, **Move with D-pad** moves the sprite horizontally. Use **Jump** on a button event to make a grounded sprite jump.

The top-down view uses zero gravity. **Move with D-pad** moves the sprite on both axes. Diagonal and straight movement have the same speed. Attacks and facing-mode projectiles follow the last movement direction. By default, the room has solid edges. Lower sprites appear in front of higher sprites in the same visual layer.

Use a collidable layer for walls. Top-down enemies use four-direction A* on the tile grid. Platform enemies search for supported landing cells and use gravity to estimate jumps and falls.

## Shader pipelines

Open **Shaders** and select an existing graph from the library or choose **New shader…** to start from a template. Templates include CRT scanlines, drifting mist, a day/night cycle, heat shimmer, pixelation, and duotone. The inline workspace keeps the library and live room preview beside the graph.

Use **Add node…** or right-click the canvas to open the searchable node cards. Drag from a result to an input, or drop a wire on empty space to choose a compatible node. Wire a color result to **Fragment output**. Parameter nodes expose defaults that can be overridden from a Shader pass block.

Drag the canvas to pan, scroll or pinch to zoom, and use **Fit View** to frame the graph. Use **Arrange nodes** to lay it out from left to right. Select nodes or wires to delete them. The toolbar supports duplicate, undo, and redo, and the graph supports keyboard copy and paste. Studio keeps unsaved edits while you switch views and writes node positions with **Save shader**.

The preview runs the selected room. Choose Room or Display to test the effect before or after the HUD, pause the preview, or toggle the effect to compare it with the scene. Studio uses WebGPU or WebGL 2 for this preview and keeps the last working effect while you edit. Saving creates a shader asset you can reopen and use in either script pipeline.

Use **Shaders → Load shader…** to import a `.spv` or `.spirv` fragment shader. The shader details list the uniforms that Studio found. You can also use the bundled shader presets.

Open a **Room script**, add **Apply room shaders in order** under **On init**, and put **Shader pass** blocks inside it. The first pass receives the room scene, and each later pass receives the last pass's output. The HUD is drawn over the finished room. Use **Apply display shaders in order** in the **Game script** to process the composited, scaled display, including the HUD. A pipeline replaces the previous one in its scope. An empty pipeline clears it. You can set a pipeline from initialization, timers, or other events. Each pipeline supports up to eight passes.

Each **Shader pass** block shows the numeric inputs for the selected shader. You can connect expressions to them. Missing custom uniform values start at zero. Stock passes provide their own defaults.

```wafflescript
on init
  apply_shaders
    shader("preset:fog", strength: 28)
    shader("my_shader", strength: 0.7, tint: [1.0, 0.85, 0.6])
  end
end
```

### Custom shader interface

Use a single SPIR-V fragment entry point. The player supplies normalized UV coordinates at location 1 and white vertex color at location 0. Output a `vec4` at location 0. A combined `sampler2D` at set 2, binding 0 samples the previous pass. An optional `std140` uniform block at set 3, binding 0 can contain up to 256 bytes of 32-bit floats, signed or unsigned integers, and vectors of those types. Keep uniform member names when compiling if you want the block editor to show them. Use `vec2 resolution`, `float time`, or `float delta_time` to receive the current pass size and the simulation clock automatically.

```glsl
#version 450
layout(location = 1) in vec2 uv;
layout(location = 0) out vec4 color;
layout(set = 2, binding = 0) uniform sampler2D screen;
layout(std140, set = 3, binding = 0) uniform Parameters {
  vec2 resolution;
  float strength;
} params;
void main() {
  vec4 sampleColor = texture(screen, uv);
  color = vec4(mix(sampleColor.rgb, sampleColor.bgr, params.strength), sampleColor.a);
}
```

For GLSL, run `glslangValidator -V color-grade.frag -o color-grade.spv`. Studio validates the shader at import and translates it to WGSL and Metal shader source. Custom passes use WebGPU in the browser or SDL's Vulkan or Metal GPU renderer. The software player and libretro core draw the unfiltered scene when a pipeline is active.

## Background gradients

Use **Background** in a Room script to set the background color or image and draw gradients behind room art. Linear gradients have a start and end point and up to eight indexed color stops. Radial gradients blend up to eight colored foci over the room's background color. Positions run from 0 to 1 across the viewport, and radial radii are measured in units of its shorter side. Move or recolor a stop or focus by setting the same slot again.

```wafflescript
on init
  set_room_background("#1e1e2e")
  set_background_gradient("radial", "dithered")
  set_gradient_focus(1, 0.25, 0.7, 0.55, "#cba6f7")
  set_gradient_focus(2, 0.8, 0.2, 0.65, "#f9e2af")
  set_gradient_palette_color(1, "#1e1e2e")
  set_gradient_palette_color(2, "#cba6f7")
  set_gradient_palette_color(3, "#f9e2af")
end
```

For a linear ramp, call `set_gradient_axis(x1, y1, x2, y2)` and `set_gradient_stop(slot, position, color)`. Choose `"smooth"` for continuous color or fill up to 16 palette slots for ordered dithering. `clear_gradient_slot("focus", 2)` removes one focus. `set_background_gradient("none", "smooth")` clears the gradient.

## Organize assets

Drop files onto **Assets** or choose **Load asset**. Studio routes each file to its asset folder. For an Aseprite or PNG file, choose a sprite, tileset, bitfont, background, cover, or source image. The prompt shows the relevant import options. PNG fonts expose the glyph grid, and MIDI tracks use an imported SF2 SoundFont.

Select an asset to rename it or edit its tags. Renaming updates the display name and keeps existing script and room references. Use the search, type, and tag filters to find assets.

## Prepare assets and scripts

Use [demo/project.json](demo/project.json) as an example. Put art and audio files in the project's `assets/` directory. Studio rebuilds the saved project when these files change. Select **Rebuild assets** to start a rebuild manually.

- **Entities.** Choose a sprite file in **Entities → New entity**. Set the physics mode. Open **Collision filter** to set the category, mask, and group. Open **Appearance** to set the visual layer. Select **Code** beside an entity in the project sidebar to open its script. Select **Blocks** or **Text** in the script editor. Studio saves each sprite script as CBOR. The compiler converts the blocks to operation codes and operands.
- **Tiles.** Set the project tile size to 8 × 8, 16 × 16, 24 × 24, or 32 × 32 pixels. Use the same size for all tile frames. Import the Aseprite file as a tile set. Studio creates a tile for each tag. To add a tile while Studio is open, add a tag to the Aseprite file in the project folder and save the file. The new tile appears in the room palette. Save the project to keep the tile definition. The project sidebar lists each source file once. Select a tile in the room palette to paint with it. Each frame in the tag is a variant. Use `:animated:` or `:fluid:` to play the frames in sequence. Use `:mirror-x:`, `:mirror-y:`, or `:rot-90:` to transform the frames. Use `:mirror-all:` to add horizontally flipped, vertically flipped, and doubly flipped variants after the original ones. Editing modifiers keeps the tile’s ID when its tag name still identifies it uniquely. Set tile properties in Studio.
- **Art.** Studio reads `.ase`, `.aseprite`, and `.png` files. It uses indexed palettes, transparency, frame times, and tag playback direction. Flatten native Aseprite tilemap layers and layers with non-normal blend modes before import.
- **Collision.** Enable collision on a room layer to use its tile physics. Available tile types include solid tiles, one-way platforms, ladders, breakable tiles, fluid zones, and rigid bodies. The compiler combines adjacent static collision tiles and makes a separate texture atlas for each room.
- **Audio.** Register WAV, Opus, Ogg Vorbis, or QOA files. Studio converts WAV to QOA by default. Use mono or stereo PCM or float32 WAV for this conversion. Clear the QOA option to keep the WAV file. Set music and ambient sound in the **Room** panel. Use **Play sound** in a sprite script for event sounds.

## Write game logic

Open **Code**, select **Blocks**, then select **Variables**. The **Set** and **Get** blocks use a scope and a name. Select the same scope and name each time you use a value.

| Scope | Duration | Initial value |
|---|---|---|
| Local | One entity instance | Zero |
| Global | One game session | Value in **Game**, or zero |
| Flag | One game session | Value in **Game**, or false |

A room change keeps the global variables and flags. It creates new local variables for the instances in the next room. A game reset restores the initial global variables and flags.

Connect boolean variables, comparisons, or input conditions to **If** and **While**. Use **Repeat** for a fixed number of iterations. Use **Wait** to continue an event after a number of game ticks. The runtime also pauses long scripts after a fixed number of instructions. It continues those scripts on later ticks. A running event has one continuation for each instance. A second occurrence of the same event does not start another continuation.

WaffleScript has integers, reals, booleans, and strings. Use an explicit conversion for mixed numeric arithmetic. See the scripting guide for type rules, math functions, and translation tables.

## Viewport, tiles, math, and text

Use **Camera** for viewport bounds and overlap checks. The viewport reporters give the visible rectangle in room pixels after camera zoom and clamping. Use **Room** for room-edge checks and **Tiles** for tile contact. Tile checks can match an asset from the project or a behavior such as solid, one-way, ladder, fluid, sensor, breakable, or decorative. **This entity** means the entity running the script. Select **the top face** to check for an entity standing on the tile.

```wafflescript
on tick
  if camera.touching_edge(entity.id, "left")
    velocity(0, entity.vy_real)
  end
  if tile.touching_kind(entity.id, "ladder", "any") and action.up
    velocity(entity.vx_real, -2)
  end
end
```

**Math & logic** includes arithmetic, rounding, trig, clamp, interpolation, and seeded random numbers. `math.mod(-5, 3)` returns `1` and `-5 % 3` returns `-2`. **Text & HUD** includes joining, length, letter, slice, search, replacement, case conversion, trimming, and numeric formatting. Letter positions and inclusive slice bounds start at 1 and count Unicode code points. A missing letter returns an empty string and a missing substring position returns 0.

## Text resources

Open **Resources** to add text, choose languages, and edit translations. In Blockly, drag in a **Resource** block from **Text** and choose **+ Add resource…** from its dropdown. Studio saves the entry in the project’s resource table and selects it on the block. Choose **Edit resource…** in the same dropdown to change the selected entry or its translations.

Use `R.greeting` or `R["greeting"]` in WaffleScript when the key is known. Use `text.lookup(local_string.key)` or **Look up text for** when the script computes the key. An unknown computed key returns an empty string. Each playable export includes a read-only table with the selected language and its fallbacks.

## Export a game

In Studio, open **File → Export…** and choose **Standalone web game**. Studio saves the project and downloads one HTML file. The file contains the game cartridge and the WebAssembly runtime. Open it in a browser or put it on a static web server. The game can run offline. On Android, use a browser that supports WebAssembly and use the touch controls.

Choose **Cartridge** to download the `.waffle` file. If the project has translation tables, select a language for each playable export. To play this file, select **Open cartridge** in the player.

After you build Studio, use these commands to export from the command line.

```sh
npm run cart -- path/to/project path/to/game.waffle
npm run cart -- path/to/project path/to/game-es.waffle --locale es
npm run export:web -- path/to/project path/to/game.html
npm run export:web -- path/to/game.waffle path/to/game.html
```

## Run a separate player

Standalone players open without a cartridge. Open a `.waffle` file to start a game.

### Web

In Studio, select **File → Export… → Web player** to get a separate copy. Run `npm run build:player` to build only the web player. Open `web-built/standalone/gamewaffle-player.html` in a browser. Select **Open cartridge**. The player can run offline.

Set cover art in **Game → Project settings… → Cartridge cover** before exporting. Drag the image or use the position and zoom sliders to frame it in a 512 × 512 px square. **Fit** shows the complete image with transparent padding as needed. **Edit crop…** reopens the original image for adjustments. Each exported cartridge includes the same crop, including separate language editions.

### Desktop

Install CMake and the SDL3 build dependencies for your operating system. Run this command.

```sh
npm run build:native
```

Open the player in `web-built/native/`. Press **F1** to open a cartridge. You can also drop a cartridge on the window or give its path to the executable. Press **F2** to reset the game. On Linux and Windows the player shows the touch overlay for direct touchscreens reported by SDL. Use **F3** to toggle it, or launch with `--touch` to enable it manually.

### macOS

Build Studio and the native player from the GitHub checkout. Install the Xcode command-line tools, CMake, Rust, and Node.js first.

```sh
git clone https://github.com/isaiahpettingill/GameWaffle.git
cd GameWaffle
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.105 --locked
npm ci
npm run build
cargo build --release --locked --manifest-path studio/Cargo.toml
cargo build --release --locked --features bundled --manifest-path player/Cargo.toml
./studio/target/release/gamewaffle-studio
```

Run `./player/target/release/gamewaffle-player` to open the cartridge picker.

### Android

The native Android player opens to **My games**. Tap **Choose folder** to index the `.waffle` files in a directory and its subfolders. The app remembers that directory. You can also open an individual cartridge from **Library options**. In portrait, the touch gamepad sits below the display. In landscape it overlays the lower corners. Use **Game menu** to save, load, toggle the touch controls, or return to the library.

To build the APK, install Android NDK r27c, Android platform 35, Android build tools 35.0.0, JDK 21, CMake, and Ninja. Get the SDL 3.4.2 source files. Set `ANDROID_NDK_HOME`, `ANDROID_PLATFORM_JAR`, `ANDROID_BUILD_TOOLS`, `JAVA_HOME`, and `SDL_SOURCE` to the paths for these tools and files.

```sh
rustup target add aarch64-linux-android x86_64-linux-android
bash player/android/build.sh
```

Install `web-built/android/GameWaffle-Player.apk` on an Android device. Local builds use a debug key. Tagged releases use the release key.

### Render resolution

Open the **Game script**. Set a fixed display resolution or set adaptive display bounds and pixel zoom under **On game startup**. The camera follows Player 1 by default and stays within the room boundaries.

## Play with other players

Connect standard-mapped gamepads or use the keyboard. The players support four local slots. In the web player, set **Players** to the number of players. Compare the number of gamepads and player slots. If there are fewer gamepads, use the keyboard for the first slot. Gamepads use the other slots.

Couch players share one screen by default. Games can enable split-screen with automatic merging in the desktop and Android player and in the Libretro core. [WaffleScript multiplayer controls](docs/wafflescript.md#couch-and-lan-players)

| Control | Player 1 keyboard | Player 2 keyboard (web) |
|---|---|---|
| D-pad | Arrow keys or W A S D | I J K L |
| A | Semicolon, Z, or left mouse button | N |
| B | Quote, X, or right mouse button | M |
| X | Space or C | Comma |
| Start | Enter | Period |

To play on a local network with the web player, start a host.

```sh
npm run studio:browser -- --cart path/to/game.waffle --lan
```

On each device, open `http://HOST_IP:4871/player.html`. Select the number of players on that device. Then select **Join LAN**. All devices share the same room. The host assigns a total of four player slots.

## Use the runtime

Use the [SDK reference](docs/sdk.md) for cartridge layout, block source, and host APIs. Cartridges use format version 2.

LAN clients connect to `/lan` with WebSocket. Send a `join` message to request player slots. The host returns their slot numbers in `slots`. Send an `input` message with the button states for each client slot. The host sends binary snapshots at 30 Hz. Get the matching cartridge from `/lan.waffle`.

The runtime uses [Rapier2D](https://rapier.rs/) with four-lane SIMD, enhanced determinism, and thin LTO in release builds. Web builds require WebAssembly SIMD128. Desktop builds use SSE2 on x86-64 and NEON on ARM64.

## Edit a project

Open **Assets** to browse thumbnails, sort by name or type, and filter by tags. Click a sprite to open its entity. Use the row’s details button to rename the file in the library or edit its tags. Press Enter after typing a tag to add it. To import a file, drop it on the library or select **Load asset…** and choose its type. Studio reuses an identical source file and gives different files separate paths. Existing entities and tiles keep their IDs. A PNG supplies one frame.

Use **Open in default editor** on an `.aseprite` or `.ase` asset to open it in the system’s associated app, such as Aseprite or LibreSprite. Save the same file in that app and Studio reloads it automatically. Keep Studio open while editing. For a `.waffleproj` archive, Studio opens a temporary copy and writes saved changes back into the archive.

Open **Tools → Updates** to check Studio and the desktop runtime. Studio detects the installed versions and the host platform.

Select **File → Export… → Editable project** to copy the project to a single `.waffleproj` file. Studio keeps its files in a virtual filesystem. A save replaces the archive. Use this command to open an archive or a folder after you build Studio.

```sh
node packaging/studio.mjs path/to/game.waffleproj
```

Select **File → Export… → Cartridge** to distribute a game. The cartridge contains compiled instructions and room atlases. The player checks an Ed25519 signature before it runs the game. The public key travels with the cartridge. A third party can build and sign a different cartridge.

## Edit on Android

Extract `GameWaffle-Android-Studio.tar.gz` in Termux. Install Node.js 24 or later. Run the following command from the extracted directory. Studio opens in the local browser. Use **Project**, **Editor**, and **Settings** to switch panels on a narrow screen.

```sh
node packaging/studio.mjs
```

## Paint tiles and move entities

In the Room editor, use **Brush** or **Rectangle** to drag a tile from the
palette onto the active layer. To move an entity, use **Select instance** and
drag it. **Place entity** places on a click in empty space and moves an existing
instance when you drag it.

The room canvas has space beyond every edge. Middle-drag or use two fingers to
pan. A stepped mouse wheel zooms around the pointer. Use a pinch to zoom on a
touchscreen or touchpad. Continuous touchpad scrolling pans. Hold Ctrl while
scrolling to zoom with a smooth wheel, or Shift to pan. **Fit** centers the room.

Choose a PNG or Aseprite image using **Background image** in the room inspector.
Studio writes the asset into the room's **On init** stack. The first frame is
drawn behind the room. Set the scroll value in the script from 0 for a
screen-fixed image to 1 for a room-fixed image.

## Generate a HUD minimap

Add **Set minimap** to the Game script and choose **World** or **Explored**.
Studio lays out the room outlines from the directions of their exits,
draws links, and highlights the current room. Explored mode reveals a room
when the player enters it and saves discoveries with game progress.

## Connect rooms

Select **World**. Select a room and an exit. Select a destination. Use **Once per save** for a fixed random choice in each new game. Use **On each crossing** to draw again. Add a required flag to lock an exit.

For a continuous crossing, connect opposite edges in both directions. Select **Fixed** and **Connect opposite edges** on both exits. Use equal edge lengths. The camera shows terrain from the next room before the player crosses. Sprites and physics start when the player enters the next room.

Use a camera block to follow an instance, show a position, or follow a selected player. Normal enemy scripts and bodies pause outside the camera and player activity areas. Enable **Entities → Run scripts off camera** for a boss.

## Items, dialogue, and saves

Use **Collections** to declare an inventory, add objects, and read or update their fields. Use **Text & HUD** to show a counter, message, or game menu. Press A to advance dialogue.

Import a custom font in **Assets → Bitfonts**. Use **Set HUD font** or pick a font on a text block to change it from a script.

On desktop, press **F4** to map a controller. Press each control in order. The player saves the mapping for that controller model. Press **F5** to save, **F6** to select a slot, or **F9** to load. Android has save slots in **Game menu**. The web player has a slot selector.

Each save includes progress and the active room’s entities, spawned entities,
physics poses and velocities, animation progress, open menus, and waiting
scripts. Scripts resume when their compiled instructions match. Older saves
still restore their progress fields. The runtime reconstructs contacts when opening a portable save. Libretro save states also preserve the Rapier solver state and the audio playback positions for replay.
Set `saveId` in the project to keep its save identity when you rename a game.

## Build release packages

The package workflow builds a Linux AppImage, a Windows NSIS installer, an Android player APK, and an Android Studio archive. Desktop packages include Studio and the SDL3 player. To start only the Linux player, use `GameWaffle-x86_64.AppImage --player`.

Run this command from the checkout with Bash, Python 3, the JDK, and an authenticated GitHub CLI. Use a new path. Keep the key and its password for future Android updates.

```sh
bash packaging/signing-key.sh "$HOME/GameWaffle-release.p12"
```

Set the version in `package.json` and merge to `main`. If that version has no published release, GitHub builds the packages, signs the APK, and publishes the files under the matching tag. For example, version `0.1.0` uses tag `v0.1.0`. You can also push a version tag or run **Build GameWaffle** on `main` to retry. Publication requires the `ANDROID_SIGNING` secret.

GameWaffle uses the [0BSD license](LICENSE).

## Add particle effects

Select an entity in **Entities → Particles**. Select an effect and set the rate in particles per second. Each instance has its own emitter. The presets include sparks, dust, smoke, flame, bubbles, rain, and snow.

Use **Appearance** in Blockly for bursts, continuous effects, and stop commands. Emitted particles finish their movement after the source disappears. The runtime limits a room to 2,048 live particles and 256 new particles per tick. Particles use a separate random sequence from room connections.

Use an active flag on a sprite, tile, instance, or map layer to control when it exists. A flag change also updates collision and pathfinding for conditional solid tiles. Combine conditions on a definition and its placement to require both.

See [Edit a script](docs/wafflescript.md) for text mode, modules, and desktop export.

## Play in RetroArch

1. Export a **Cartridge** from Studio.
2. Get the GameWaffle libretro ZIP for your platform. Use **android-arm64-v8a** for a Pixel 8.
3. Extract the ZIP. Put the .info file in the RetroArch core information directory. Use **Load Core → Install or Restore a Core** to install the .so or .dll.
4. Select **Load Core → GameWaffle**. Select **Load Content** and open the .waffle file.

Connect up to four RetroPads. Use the D-pad to move. The south, east, and west
buttons operate A, B, and X. Use Start for the game menu. RetroArch supplies
keyboard mapping and the Android touch overlay.

RetroArch saves game progress in its save RAM file. Save states use GameWaffle
checkpoints. A checkpoint restores the active room, entity state, inventory,
variables, and compatible script continuations.

To build a desktop core from source, run this command. Use the same SDL build
dependencies as the desktop player.

```sh
cargo build --manifest-path player/Cargo.toml --locked --release --lib --features bundled,libretro
```

On Linux, rename player/target/release/libmain.so to gamewaffle_libretro.so.
On Windows, rename player/target/release/main.dll to gamewaffle_libretro.dll.
The core information file is in player/libretro.

## Run local checks

Run `npm run check` to test the Rust runtime, build the players, and check game
logic, WaffleScript, and desktop export. To test the editor at four screen
widths, install playwright-core 1.58.2 and set CHROME_BIN to your Chromium
executable. Run `npm run check:editor`.

After building, run `node packaging/bench-runtime.mjs` to measure script parsing and compilation, cartridge loading, and WebAssembly frame delivery. Pass Wasm build directories to compare them on identical cartridges. Use `--write-fixtures DIR` to keep the benchmark cartridges for native runs. For native timing, run `cargo run --release --manifest-path runtime/Cargo.toml --example bench-runtime`, optionally passing cartridge files after `--`. Use Node's `--cpu-prof` to capture a profile of the Wasm benchmark.

To test the packages without publishing a release, run **Build GameWaffle** on a development branch.

## Recover an edit

Studio writes a recovery file when you change the project, a block workspace, or a text script. Open the same project path after a restart. Select **Recover edits** or **Discard draft** for a project draft. Open the same sprite or module to recover its script. Studio saves valid project and script edits automatically. A draft can contain incomplete text or disconnected blocks.

Use **Edit → Undo project edit** or **Redo project edit** for room edits, game settings, asset definitions, file imports, and saved script or module changes. Studio keeps the last 50 project edits in the current session. Blockly and the text editor have their own edit histories.

In Blockly, Ctrl-click, Command-click, or Shift-click to toggle blocks in a selection. Copy and paste the selection with the usual keyboard shortcuts. Consecutive selected statements stay connected, and selected blocks keep their inputs. Escape clears the selection.

## Debug a room

Select **Tools → Debug room**. Studio starts a separate simulation and pauses before its first script instruction. Select **Step instruction** to execute one register instruction. Select **Continue** to run the game. Click the game display to send keyboard input.

To set a breakpoint, enter the event name and its instruction number. Use instance ID 0 to match any instance, or enter one instance ID. Select **Set breakpoint**, then **Continue**. The inspector shows the active script, local variables, global variables, and set flags. For a block script, the displayed line refers to its WaffleScript text form.

## HD pixel smoothing

Select **HD pixel smoothing** in the room shader tab. The player draws the scene at twice the width and height. **Strength** controls the blend across diagonal edges. The HUD keeps sharp pixels. The logical viewport, collisions, and input coordinates use the original resolution.

This preset uses the contrast-sensitive edge reconstruction used by Lemuroid's HD shader family as a design reference. GameWaffle uses its own fixed 2× Rust filter. See the [Lemuroid shader selection](https://github.com/Swordfish90/Lemuroid/blob/3625bc121d5d79fd4b80ce930fb0f3236c9334e8/lemuroid-app/src/main/java/com/swordfish/lemuroid/app/shared/game/ShaderChooser.kt) and the [LibretroDroid CUT shaders](https://github.com/Swordfish90/LibretroDroid/blob/8835c3098514390a271e36983957f7bb5f40abf1/libretrodroid/src/main/cpp/shadermanager.cpp).

## Stop a playtest

**Play game** and **Play room** open a separate window. Select **Stop** or press **Esc** to close it and return to Studio.

## Studio terms

| Term | Meaning |
| --- | --- |
| Asset | A project resource, such as an image, tile, or sound. |
| Sprite | The image or animation that an entity displays. |
| Entity type | A reusable definition with a sprite, script, and physics properties. |
| Instance | One occurrence of an entity in a room. |
| Player | One of four input slots assigned to an instance. |
| Control | A D-pad direction or a console button. |
| Action | A named input bound to one or more controls. |
| Inventory | An ordered collection that owns typed objects. |

To make an entity playable, select it in **Entities**. Select a player and **Place player in room**. Click the map to place the instance. To assign an existing instance, select it and set **Controlled by**. An actor without a script starts with built-in movement. Clear **Built-in movement** to control movement from its script.

In the **Game script**, use an **Input action** block with **Bind to** blocks from **Input**, or write `input jump = a, x`. Under **On tick**, read the action’s held, pressed, or released state from **Input**. Define menus in the same script with **Menu** and **Menu option** from **Text & HUD**, or write `menu pause = "Pause", "Resume", "Quit"`.

## Entity clones

Use **Clone entity** in **Entities** to copy a live instance. The new entity receives an independent copy of its local variables, along with its current position, motion, appearance, health, and tags. It starts without a player assignment or a room instance name.

Use **When cloned** in **Events** to set up a clone before its first tick. Use **Delete this clone** to end its current script and remove it. Clones are saved with the active room and cleared when you leave it. Use `entity.last_clone` for the result of your last attempt, or `0` if creation failed.

```wafflescript
on tick
  if pressed.a
    clone_entity(entity.id)
  end
end

on clone
  set_position(entity.x + 32, entity.y)
  wait(120)
  delete_clone()
end
```

## Initialization and settings

Open **Game script** from the **Game** tab or the script picker. The starter script declares globals, flags, events, and constants. Its **On game startup** stack sets display resolution, camera behavior, the minimap, and the first gamepad's player slot. Keyboard input belongs to Player 1. Use **Controller connected?** or Game script events such as `on controller connected 2` and `on controller disconnected 2`. Removing a gamepad leaves the other gamepads in their slots. Use **Assign player** or **Set entity visible** to control who can play an entity and when it appears.

Add **On init** from Events to get the matching **Init properties** block for the current script. The **On game startup** block comes with **Init game properties**. Keep this block first under its trigger, then add any other startup logic below it. Initialization runs once for each new room, entity, or scripted tile. Use **On tick** for behavior that should repeat each frame.

**Game → Room defaults…** supplies values for new rooms. Studio copies them into each new room's **Init room properties** block. Edit that block to change the room's camera, background, borders, gravity, music, ambience, or shader. The background picker edits the same script.

Inside **Init entity properties** or **Init tile properties**, use **Initial body** and **Initial property** to override the type's physics defaults. These values must be literals. The compiler bakes them into the entity type or tile variant, so a static tile with only these values needs no runtime script. For example, to configure a fluid tile variant:

```wafflescript
on init
  init_properties
    property mode = "fluid"
    property density = 2.5
    property drag = 3
  end
end
```

Tile scripts are selectable by variant. Aseprite tags marked `:animated:` seed an animation command in the tile script. The script can select a frame, advance frames, set playback, change friction, and respond to an entity contacting the tile. Event handlers can read the sender and an optional entity payload. **Every** and **After** timers take seconds.

Import MIDI tracks in **Assets → Sounds** and pair each track with an SF2 SoundFont. Studio renders the tracks with RustySynth when building the cartridge. Room music and ambience blocks use the same audio picker for MIDI, WAV, Ogg Vorbis, and Opus sources. Use the **Drawing** blocks to set fill and stroke and draw shapes in room or HUD coordinates.

## Collections

Declare object types, inventories, numeric arrays, and optional Game or Player property objects in the Game script. In Blockly, look in **Collections**. WaffleScript uses one-based indexes.

```wafflescript
object item
  label: string = "Key"
  count: integer = 1
end

inventory backpack: item
array scores: integer

on init
  inventory_append("backpack", "item")
  inventory_set("backpack", 1, "count", 2)
  array_append("scores", 100)
end
```

An inventory owns its objects. Use a collection name, index, and field path to read or write scalar properties. An object can own another typed object, up to 16 levels deep. Arrays hold integers or reals. Game and Player property objects use fixed indexes, 1 for the Game singleton and 1 through 4 for players. The Game singleton's `globals.<name>` and `flags.<name>` access the same values as ordinary global and flag expressions. The `players` object's `items.<name>` paths access counts for existing item definitions. Collections enforce a shared size budget on writes to preserve space for saved game state.

WaffleScript uses a threaded interpreter and compiles hot stretches of real arithmetic with Cranelift on x86-64 and ARM64 desktop hosts. The web player compiles those stretches to WebAssembly and runs them through its function table. Identical kernels share compiled code within a game. Each simulation tick can compile one new kernel. The interpreter handles the remaining instructions and debugging. Run `node packaging/bench-vm.mjs` after building to compare the interpreter and JIT locally.
