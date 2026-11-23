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

The `scripts` override is a map from sprite IDs to Blockly source objects. Each script has an `events` object. Each event contains an array of statements.

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

Use `{ "scope": "local", "get": "name" }` to get a local variable. Use `global` for a shared variable. Use `flag` for a Boolean value. Undefined values read as zero. The runtime converts zero to false and other values to true when it reads a condition or sets a flag.

Use an integer, a Boolean, a variable read, a button read, or an operation as an expression. Use `{ "button": "a" }` to read the current state of button A. Use `calc`, `left`, and `right` for an operation. The `not` operation uses only `left`.

The language can express integer counter machines. The implementation applies instruction, integer, and memory limits. Small values use signed 64-bit integers. Larger calculation results can use up to 8,192 bits. A script that reaches a limit reports a script error.

## Rust host

Load the cartridge with `Runtime::from_cartridge(bytes, room)`. Use `None` for the starting room. Call `step_inputs([Input; 4])` at 60 Hz. Read actors and events with `view()`. Use `scripted_global`, `flag`, and `local` to inspect script values. These calls return exact integer values as decimal strings.

The Wasm host can call `step_buttons(mask)`. Each player uses one byte of the mask. Assign bit 0 to Up, bit 1 to Down, bit 2 to Left, and bit 3 to Right. Assign bits 4 through 7 to A, B, X, and Start. The return value is a JSON snapshot.

Call `reset()` to restore the starting room and initial values. A script error includes the actor ID, event name, and error text.

## Cartridge sections

| Offset | Size | Data |
|---|---:|---|
| 0 | 6 bytes | Magic bytes `47 57 41 46 00 02` |
| 6 | 4 bytes | Compressed simulation size, little-endian |
| 10 | 4 bytes | Expanded simulation size, little-endian |
| 14 | Varies | Raw DEFLATE data for the CBOR simulation section |
| After simulation data | Varies | CBOR media section with PNG atlases and audio |

Compiled instructions use 8-bit opcodes, 8-bit registers where applicable, and little-endian 16-bit indexes. Repeated names and constants use a pool for each program. The runtime resolves each instruction handler and jump target when it loads the cartridge. The dispatch loop calls each pre-resolved handler. It has no opcode lookup in the dispatch loop.

Media remains compressed in its source format. The player loads the active room atlas when necessary. The compiler puts occupied static tile chunks into the room atlas. A playable cartridge contains no editor thumbnail data.

The final 96 bytes contain a 32-byte Ed25519 public key and a 64-byte signature. The signature covers the header, simulation, and media. Set `GAMEWAFFLE_SIGNING_KEY` to the path of an Ed25519 private PEM key to sign repeat builds with the same key. By default, the compiler makes a key for the current process.

See the [engine command reference](blocks.md) for commands, events, and actor readings.
Run `node packaging/sdk-reference.mjs` after you change the schema.

Set **Remember removal** on a named instance to keep it removed after a room
change or a save. Keep the instance name stable across game updates. Set
**Remember destroyed tiles** to keep a removed tile absent at its layer and cell.

Use **Follow all players** to center the view between the outermost players.
Use **Set checkpoint** and **Return to checkpoint** to retry within the current
session. Disk save slots have a separate lifetime.

In a damage event, read `actor.other_player` to award an item to the player
who dealt damage. Player numbers range from 1 through 4. Read `actor.item_count`
after a player inventory command. Read `actor.last_spawn` after the spawn
tick completes. To get a yes or no answer, ask a question, wait one tick, and
read `actor.answer`. A selects yes. B selects no.

## Native LAN games

Use the same cartridge file on each computer. To host for one remote player,
run `gamewaffle-player --host 0.0.0.0:4872 1 game.waffle`. Replace 1 with 2
or 3 for more guests. Each guest runs
`gamewaffle-player --join HOST_IP:4872 game.waffle`. Each computer supplies
one controller. The host assigns slots in connection order. The players exchange
button states before each simulation tick. A dropped connection ends the session.
