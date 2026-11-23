# Edit a script

Open **Code** beside an actor. The room map stays open while you edit. Select **Text** to open CodeMirror. Studio saves valid edits automatically. If a script is incomplete, Studio keeps a draft for that actor.

Both views use one compiler. The cartridge contains register bytecode. Studio
keeps comments with the text until you change the program in Blocks.

## Events and data

New actors start with an **On tick** block that applies room gravity. Put the gravity block inside a condition to control when the actor falls. A dynamic body uses its gravity scale and the room gravity once per physics step. A modifier of `none` uses a multiplier of 1. A modifier of 0 disables gravity for that step. Existing actors use automatic gravity until their script uses `apply_gravity`.

```ruby
on tick
  apply_gravity(none)
  if pressed.x and actor.grounded
    animate("jump")
    jump_force(240)
  end
end
```

Select a tag from the actor's animation menu. This example uses a tag named `jump`. Force uses newtons. For direct control, use `force(x, y)` or `impulse(x, y)`. A negative Y value pushes the actor up. `pressed.x` is true on the first tick of a press. Use `action.x` for held input. Optional inputs accept `none` or an omitted trailing argument. Zero is a numeric value.

Start an event with `on`. End it with `end`. Use `if`, `else`, and `while`
for control flow. Use `wait(1)` to resume on the next tick. Use a number,
a true or false value, or an expression for a numeric block input. Put text
and engine options in double quotes. Start a comment with `#`.

```ruby
on a
  if item.key < 1
    say("Find the key.")
  else
    flag.open = true
  end
end
```

Use `local.name` for a actor instance and `global.name` for the game.
Use `flag.name` for a game flag. Read a button with `button.a`.

## Modules and routines

Select **New module**. Enter a name such as `score`. Define a function in
the module. A function returns one expression and takes up to two parameters.

```ruby
def bonus(points, multiplier)
  return points * multiplier
end
```

Select the sprite again. Import the module with `use`. Call a module routine
with its qualified name. A procedure contains a stack of commands and takes
up to two parameters.

```ruby
use score

proc award()
  global.points = global.points + score.bonus(5, 2)
  burst("sparks", 8)
end

on b
  award()
end
```

In Blocks, open **Routines** to find the same definitions and calls. The compiler
expands each call at build time. Use a loop for repeated work. Recursive calls
and circular module imports cause a build error.

## Project files

| Path | Contents |
| --- | --- |
| `project.json` | Game settings, rooms, connections, and asset references |
| `assets/sprites/` | Sprite sources in PNG or Aseprite format |
| `assets/tiles/` | Tile sources |
| `assets/audio/` | Sound and music sources |
| `scripts/sprites/` | One CBOR script per actor |
| `scripts/modules/` | Shared WaffleScript modules with the .ws extension |

A sprite can use a .ws file as its source. Set its script path in project.json.
Keep one source per sprite. Studio reads and writes that source in either view.
A folder project and a .waffleproj archive use the same paths.

## Desktop export and updates

Save the project. Open **Export**. Select **Linux game** or **Windows game**.
Extract the ZIP. Keep the player and game.waffle together. Start the player.
The game uses the runtime in its folder.

The desktop edition of Studio includes the runtime for its platform. To get
the runtime for another platform, select **Export**, then **Updates**. Select
the platform, check the release, and install the runtime. Export the game again
to include a newer runtime. Select **Studio** to update the application. Close
the current Studio session before you use the new version.

## Input actions

Register `jump` in **Game → Controls**. Use an event for each change of state. Read `action.jump` in an expression to test whether the action is held. When two controls map to the same action, the release event starts after both controls are released.

```ruby
proc launch(speed)
  jump(speed)
end

on pressed.jump
  launch(8)
end

on released.jump
  local.jump_finished = true
end
```

Use `follow_player(2)` to follow player 2. Use `set_position(x, y)` to move the current instance to a room position in pixels and clear its velocity.
