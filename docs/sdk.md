# GameWaffle SDK reference

The source structure and opcode assignments are provisional. Use the compiler to make cartridges. Use the player or the Rust runtime to load a cartridge.

## Build interfaces

| Interface | Function |
|---|---|
| `npm run cart -- PROJECT OUTPUT` | Compile the project in PROJECT to a cartridge. |
| `npm run export:web -- INPUT OUTPUT` | Put a project or cartridge in a standalone HTML file. |
| `compileProject(root, { project, scripts })` | Compile project data and optional script overrides. |
| `pack(cartridge)` | Write playable cartridge bytes. |
| `unpack(bytes)` | Read media for display and audio. |

The `scripts` override maps entity type IDs and `room:<id>` keys to Blockly source objects. Each script has an `events` object. Each event contains an array of statements.

## Scripting

Blockly source uses event names from `src/schema.mjs`. Simulation ticks occur at 60 Hz. The compiler changes statements and expressions into register instructions.

Example of an event that increases a score and sets a flag.

```json
{
  "events": {
    "a": [
      {
        "op": "set",
        "scope": "global",
        "name": "score",
        "value": {
          "calc": "add",
          "left": { "scope": "global", "get": "score" },
          "right": 1
        }
      },
      {
        "op": "if",
        "condition": {
          "calc": "less_equal",
          "left": 10,
          "right": { "scope": "global", "get": "score" }
        },
        "body": [
          { "op": "set", "scope": "flag", "name": "ready", "value": true }
        ]
      }
    ]
  }
}
```

| Statement | Fields |
|---|---|
| `set` | `scope`, `name`, `value` |
| `if` | `condition`, `body`, optional `otherwise` |
| `while` | `condition`, `body` |
| `wait` | `ticks` |
| `repeat` | `times`, `body` |
| `change` | `scope`, `name`, `value` |

Use `local` or `global` for integer variables, `local_real` or `global_real`
for reals, `local_bool` or `global_bool` for booleans, and `local_string`
or `global_string` for strings. The `flag` scope is boolean. Represent a real
literal as `{ "real": 2 }`, a string as a JSON string, and a translated string
as `{ "text": "greeting" }`. Use `{ "button": "a" }` for a boolean button
check. Comparison and logical operations return booleans. In boolean contexts, zero
is false and nonzero numbers are true.

Use `calc`, `left`, and `right` for an infix operator. Use
`{ "call": "math.sin", "args": [{ "real": 90 }] }` for a math function.
Integers use exact arithmetic with a limit of 8,192 bits. Reals use finite
64-bit floating point. Type checking runs before the compiler emits bytecode.
Script errors report division by zero and nonfinite math results at runtime.

The project’s `localization` object has a default `locale` and a `tables`
map from language codes to text dictionaries. `pack(cart, { locale: "es" })`
bakes one language into the cartridge, filling missing keys from the default table.

## Rust host

Load the cartridge with `Runtime::from_cartridge(bytes, room)`. Use `None` for the starting room. Call `step_inputs([Input; 4])` at 60 Hz. Read actors and events with `view()`. Use `scripted_global`, `flag`, and `local` to inspect script values. These calls return exact integer values as decimal strings.

The Wasm host can call `step_buttons(mask)`. Each player uses one byte of the mask. Assign bit 0 to Up, bit 1 to Down, bit 2 to Left, and bit 3 to Right. Assign bits 4 through 7 to A, B, X, and Start. The return value is a CBOR snapshot as a `Uint8Array`. Use `decodeFrame(bytes)` from `src/frame.mjs` in JavaScript. Call `advance_buttons(mask, ticks)` to advance without encoding a snapshot, then read the final state with `snapshot()` when needed.

In the CBOR payload, `actors.data` contains 44 bytes per actor in little-endian order. Each row has two `u32` IDs (actor and clone source), seven `f32` values (x, y, width, height, angle, facing, health), an `i32` layer, and a `u32` flags word. A clone source of zero means the actor is not a clone. Bit 0 in the flags word indicates vertical flip. The remaining bits are zero for an unassigned player or one plus the player slot. `actors.details` contains one array per actor with image, name, shadow, and health bar.

`save_game()` returns a versioned binary save. Six header bytes (`47 57 53 56 00 01`) precede its CBOR payload. Pass the entire byte buffer to `load_game(bytes)`.

Call `reset()` to restore the starting room and initial values. A script error includes the actor ID, event name, and error text.

## Cartridge sections

| Offset | Size | Data |
|---|---:|---|
| 0 | 6 bytes | Magic bytes `47 57 41 46 00 03` |
| 6 | 4 bytes | Compressed simulation size, little-endian |
| 10 | 4 bytes | Expanded simulation size, little-endian |
| 14 | 4 bytes | Display metadata size, little-endian |
| 18 | 4 bytes | Expanded media size, little-endian. Zero means the media CBOR is stored directly. |
| 22 | Varies | CBOR display metadata with `name`, optional `locale` and `coverArt`, and `runtimeAbi` |
| After display metadata | Varies | Raw DEFLATE data for the CBOR simulation section |
| After simulation data | Varies | Media section containing a CBOR map with PNG atlases and audio. Uses raw DEFLATE when the expanded media size is nonzero. |

Compiled instructions use 8-bit opcodes, 8-bit registers where applicable, and little-endian 16-bit indexes. Repeated names and constants use a pool for each program. The runtime resolves each instruction handler and jump target when it loads the cartridge. Each handler calls the next handler directly. After at most 16 instructions, control returns to the scheduler loop. This limit bounds stack use on targets that keep tail-call frames.

The compiler uses lossless indexed PNG for images with up to 256 distinct RGBA values. Cartridge covers are 512 × 512 px PNGs. Audio retains the encoding selected by the compiler. The player decodes the active room atlas when necessary. The compiler puts occupied static tile chunks into the room atlas. Editor thumbnails are included only in editor cartridges.

Current readers also support version 2, which uses a 14-byte header with the same simulation length fields, followed by the compressed simulation and an uncompressed CBOR media section that includes the display metadata.

The final 96 bytes contain a 32-byte Ed25519 public key and a 64-byte signature. The signature covers the header and all sections. Set `GAMEWAFFLE_SIGNING_KEY` to the path of an Ed25519 private PEM key to sign repeat builds with the same key. By default, the compiler makes a key for the current process.

See the [engine command reference](blocks.md) for commands, events, and actor readings.
Run `node packaging/sdk-reference.mjs` after you change the schema.

In an entity’s **Lifecycle** settings, select **Remember state between room visits** to retain a named instance’s position, velocity, health, animation, facing direction, and local variables. Choose **Never** under **Respawn** to keep a removed instance absent. The room instance can override the entity type’s defaults. Keep instance names stable across game updates. Set **Remember destroyed tiles** to keep removed tiles absent at their layer and cell.

In **Game → Display**, set **Resolution** to **Fixed** and enter a width and height in pixels. **Adapt to window** uses the window size, pixel zoom, and resolution limits. Camera zoom changes how much of the room is visible. Follow stops at room edges and can show adjoining terrain at seamless connections. Use **Camera bottom inset** in a room’s Camera settings to leave unused rows below the screen.

In **Game → Camera**, choose **All players** to center the view between the outermost players. A room can choose its initial target. Room scripts can change the target, zoom, gravity, background color, depth sorting, music, ambience, and shaders during play. See [Room scripts](wafflescript.md#room-scripts).
Use **Set checkpoint** and **Return to checkpoint** to retry within the current
session. Disk save slots have a separate lifetime.

In a damage event, read `entity.other_player` to award an item to the player
who dealt damage. Player numbers range from 1 through 4. Read `entity.item_count`
after a player inventory command. Read `entity.last_spawn` after the spawn
tick completes. To get a yes or no answer, ask a question, wait one tick, and
read `entity.answer`. A selects yes. B selects no.

## Bitfonts

In **Game → Bitfonts**, import a font or choose an installed font for HUD text, menus, and dialogue. The built-in face supplies missing glyphs.

- **PNG** sheets use a grid. Set the glyph width and height, then click cells and enter one character per cell. Press Enter to advance. Duplicate assignments use the first cell in sheet order.
- **Aseprite** files use each tag name as its character and the first frame in that tag. Use a literal character, a code point such as `U+00E9`, or `space`. Duplicate labels use the first tag. The exact case takes priority, with a fallback to the other case.
- **YAFF** imports monochrome, single-character glyphs and reads glyph labels and basic cell metrics from the file. [YAFF file format](https://github.com/robhagemans/monobit/blob/master/YAFF.md)

## Native LAN games

Use the same cartridge file on each computer. To host for one remote player,
run `gamewaffle-player --host 0.0.0.0:4872 1 game.waffle`. Replace 1 with 2
or 3 for more guests. Each guest runs
`gamewaffle-player --join HOST_IP:4872 game.waffle`. Each computer supplies
one controller. The host assigns slots in connection order. The players exchange
button states before each simulation tick. A dropped connection ends the session.

## Libretro video

The core uses the Game script's fixed or adaptive display size for the output aspect ratio. The camera and split-screen panes fit inside that display with nearest-neighbor scaling. HD pixel smoothing doubles the output dimensions in both shared and split-screen play. Camera zoom and pane changes keep the same output aspect ratio.
