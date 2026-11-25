# Edit a script

Open **Code** beside an entity. Edit its script on the right and use the stage on the left to see the selected room. The Project sidebar highlights the room or entity whose script is open. **Play here** runs the current room in the stage. **Stop** or Esc returns to the stage preview. Select **Text** to open CodeMirror. Studio saves valid edits automatically and keeps incomplete scripts as drafts.

Both views use one compiler. The cartridge contains register bytecode. Studio
keeps comments with the text until you change the program in Blocks.

Use the **+** on an **if** block to add **else if** or **else**. Use **−** on a branch to remove it and detach any blocks inside. In Text, write `if condition then` and `elif condition then`. The `then` keyword is optional. The chain runs the first matching branch. Put independent checks in separate `if` blocks to let both run on the same tick.

Long loops yield automatically and resume from the same instruction. A `wait(1)` suspends that invocation until the next tick. Keep movement in `on tick` and use a separate event such as `on pressed.a` for a sequence that waits between actions.

## Couch and LAN players

Assign a different player slot to each playable entity in the room. Its input checks and button events then use that slot for both couch and LAN players. Use `controller_connected(1)` through `controller_connected(4)` to check the current roster. In the Game script, use `on controller connected 2` or `on controller disconnected 2` to react to changes. These events work for all four slots.

Players share one screen by default. To enable split-screen in the native player, add **Game settings → Split screen** to **On game startup** in the Game script, or use text.

```ruby
on game startup
  set_split_screen(true, 96)
end
```

Choose a merge distance in room pixels. The cameras combine into a shared view when every pair of players is within that distance and all players fit on screen. They split again as the players move apart. Use `set_split_screen(true, 0)` to keep separate views whenever there are two or more players, and `set_split_screen(false, 0)` to use the room's shared camera. You can change this setting in any Game script event.

Two players get equal panes. With three players, Player 1 gets half the screen and the other players share the remaining half. Four players get equal quadrants. The layout uses connected slots with visible player entities in the current room. The browser player uses one shared view. Use `set_default_camera("group")` in the Game script to center that view on the connected players.

For couch play, use `set_first_controller(1)` to start assigning gamepads at Player 1. Use `set_first_controller(2)` to let Player 1 use the keyboard while gamepads control Players 2 through 4.

## Room scripts

Pick a room from **Room scripts** in the script file menu. This keeps the current stage and editor view. Selecting a room in the sidebar also selects its script. Use **Room** for room settings and **Camera** for camera controls. A room script starts on each entry, runs its own tick, and reads controller 1. The room inspector supplies defaults on each entry. When you load a save, the current room state is restored before `on restored`.

```ruby
on start
  camera_follow_entity(entity.find("Elevator"))
  camera_zoom(1.5)
  set_room_gravity(288)
  set_room_background("#342850")
  set_room_depth_sort(true)
end

on tick
  if action.x
    camera(360, 160)
  else
    camera_follow_entity(entity.find("Elevator"))
  end
end
```

Choose a placed entity from the searchable **Find entity** block or connect an entity query. Set the starting zoom in the room inspector under **Camera**. Zoom is a multiplier from 0.25× to 4×, and 1× uses the game’s default zoom. **Reset room camera** restores the room’s default target and zoom. Use **Set room music** and **Set room ambience** to select a sound or choose **None**. In the room inspector under **Rendering**, use **Browse…** to import a PNG or Aseprite background into the project. You can also choose an existing project image.

## Entity sounds and contact

In **Sound**, use **Stop playing sounds for** to cut the sound effects started by the selected entity. Use **This entity** to stop its own sounds, or **Find entity** to choose another instance. Room music and ambience keep playing.

In **Entities**, use **Touching entity?** in an `if` block to check whether this entity's collider is in contact with the selected entity. Sensor overlaps also count.

```ruby
on tick
  if entity.touching(entity.find("Switch")) then
    stop_sound(entity.id)
  end
end
```

## Sprite shadows

In an entity script, open **Appearance → Set sprite shadow**. **Behind** draws an offset silhouette that follows the current animation, rotation, and flips. **Ground** draws a shadow at the sprite’s feet in top-down rooms and on the nearest surface below it in platformer rooms. Set opacity from 0 to 100. Choose **None** to clear the shadow.

```ruby
on start
  set_sprite_shadow("ground", 45)
end
```

## Health and physics objects

In an entity script, use **Combat → Show health bar** to display that entity’s health above its sprite. Bars start off. Pick the fill and background colors, or pass hex colors in text. The bar fills relative to **Starting health** in the entity’s physics settings.

```ruby
on start
  set_health_bar(true, "#a6e3a1", "#313244")
end
```

A **Dynamic** body can be pushed by another moving body. A **Breakable** body stays in place until its health reaches zero. Under **Entities**, use **Push entity** to apply an impulse to a dynamic body, **Damage entity** and **Heal entity** to adjust health, or **Break entity** to run the normal damage and destroy events immediately. Configure respawn rules on the entity or instance.

## Script constants

Open **Constants…** in the script actions menu to give a value a name and choose its type. Drag the constant from **Variables** into any compatible input. Constants are local to the script and evaluate to the same value each time.

```ruby
const crate_push = 41472

on a
  push_entity(entity.find("Crate"), const.crate_push, 0)
end
```

## Room shaders

In the room inspector, open **Shader** to pick an effect and adjust its strength. Fog, Volumetric lighting, and Lens flare add screen-space lighting over the scene. Snow, Rain, and Wind animate over the scene. HUD text and the minimap stay clear.

A room script can switch presets with **Room shaders → Set room shader**. Strength takes a number from 0 to 100. Choose **None** to turn the effect off. Use **Reset room shader** to restore the inspector preset and its settings.

```ruby
on tick
  if pressed.a
    set_room_shader("rain", 65)
  end
  if pressed.b
    reset_room_shader()
  end
end
```

## Named events

Open the picker on **Emit event** or **When I receive** and choose **New event…** to create and select an event in one step. You can also create events in the script actions menu or under **Game → Events**. The message reaches matching listeners in the current room on the next tick. Repeated messages queue behind a listener that is waiting.

The **Event sender** block returns the sending entity. Plug it into an entity query to read that entity's position, health, or fields. Check **Entity exists?** before using it if the sender might have been removed. Events from a room script have no sender entity.

```ruby
on start
  emit_event("switch_activated")
end

on received.switch_activated
  if entity.exists(entity.event_sender)
    global_real.switch_x = entity.x(entity.event_sender)
  end
end
```

## HUD text

Under **Text**, use **Draw HUD text** to give a label a font, a screen anchor, and pixel offsets. Use the same name to update the label or remove it with **Hide HUD element**. Right and bottom offsets move the text inward from those edges. Use **Set HUD font** to choose the font for counters, dialogue, and menus. The font pickers list the fonts from **Game → Bitfonts**.

```ruby
on start
  set_hud_font("builtin")
  draw_text("level_title", text.level_title, "", "top_center", 0, 8)
end
```

## Events and data

A dynamic body uses the room gravity and its own gravity scale by default. For conditional gravity, choose **Entities → Physics settings → Gravity control → Script applies gravity each tick**, then run `apply_gravity(none)` from **On tick** whenever gravity should apply. A modifier of `none` uses a multiplier of 1. Skipping the call leaves gravity off for that tick.

### Physics units

New projects use pixels and seconds for physics. Position is in pixels,
velocity in px/s, gravity in px/s², force in mass units × px/s², and impulse
in mass units × px/s. `physics.gravity()` reads the room’s current gravity.
Use `entity.mass` for the current body or `entity.mass(id)` for a target.

Water has density `1`. Keep **Mass** blank to compute it from the collider area
and entity density. An entity with density below `1` floats in water with the
default buoyancy of `1`. Use **Drag** on the fluid to damp motion. Projects
created with meter-based physics keep their original units unless migrated.

### Early exits and loops

Use **Return** in **Control** to exit the current event or procedure. When a procedure returns, its caller continues at the next statement. In a `repeat` or `while` loop, **Break** exits the nearest loop and **Continue** skips to its next iteration. In a counted loop, a skipped iteration still counts toward the total.

```ruby
on tick
  if not action.right
    return
  end
  repeat 4
    move_by(1, 0)
    if camera.touching_room_edge(entity.id, "right")
      break
    end
  end
end
```

**Code → Movement preset…** inserts editable movement into **On tick**. The platformer preset reads held directions and checks for a grounded jump on the first tick of an X press. The top-down preset reads held directions on both axes. Assigning a controller connects input to an instance. Set its body to Dynamic when it needs physics movement.

```ruby
on tick
  apply_gravity(none)
  if pressed.x and entity.grounded
    animate("jump")
    jump(192)
  end
end
```

In Blocks, start with **Events → On tick**, add **Control → If**, and plug an
**Input** block into its condition. Combine checks with **and**, **or**,
and **not** from **Math & logic**. A down check runs its branch on every tick the input is held.
A just-pressed or just-released check runs its branch once per transition.

For example, this applies horizontal force while a direction is held and jumps
once per press when grounded:

```ruby
on tick
  apply_gravity(none)
  if action.left
    force(-550000, 0)
  end
  if action.right
    force(550000, 0)
  end
  if pressed.a and entity.grounded
    jump(192)
  end
end
```

Use `button.left` for the raw controller button or `action.left` for the
input action. Named actions from the game's control map work with `action`,
`pressed`, and `released`. To move an existing `on pressed.jump` stack into
`on tick`, place its commands inside `if pressed.jump`.

Select a tag from the entity's animation menu. This example uses a tag named `jump`. `jump(192)` sets the launch speed to 192 px/s. For direct control, use `force(x, y)` or `impulse(x, y)`. A negative Y value pushes the entity up. `pressed.x` is true on the first tick of a press. Use `action.x` for held input. Optional inputs accept `none` or an omitted trailing argument. Zero is a numeric value.

Start an event with `on`. End it with `end`. Use `if`, `elif`, `else`, and `while`
for control flow. Use `wait(1)` to resume on the next tick. Use a number,
a true or false value, or an expression for a numeric block input. Put text
and engine options in double quotes. Start a comment with `#`.

```ruby
on tick
  if pressed.a
    if item.key < 1
      say("Find the key.")
    else
      flag.open = true
    end
  end
end
```

## Types and math

| Type | Literals | Actor variables | Game variables |
| --- | --- | --- | --- |
| Integer | `2`, `-8` | `local.count` | `global.score` |
| Real | `2.0`, `0.5` | `local_real.angle` | `global_real.speed` |
| Boolean | `true`, `false` | `local_bool.ready` | `global_bool.ready`, `flag.ready` |
| String | `"Hello"` | `local_string.title` | `global_string.title` |

Unset variables read as zero, false, or an empty string according to their type.
Use the name picker on a variable block to create a field, flag, or variable for its selected scope.
Conditions, logical operators, and boolean assignments or arguments accept
numbers. Zero is false and every other number is true. Read a button with
`button.a` or a mapped action with `action.jump`. `entity.grounded`,
`entity.moving`, and `entity.is_player` are entity conditions. Compare numbers
with `==`, `!=`, `<`, `<=`, `>`, or `>=`. Use `+` to join two strings.

Integer division truncates toward zero. Real division keeps the fraction.
Arithmetic, comparisons, and functions such as `math.clamp` accept mixed
numeric operands. An operation with a real operand uses real precision, so
`5 / 2.0` gives `2.5`. Real variables and inputs accept integers automatically.
For integer variables and inputs, convert reals explicitly with `math.to_integer`,
`math.floor`, `math.ceil`, `math.round`, or `math.trunc`. `math.to_real` explicitly
promotes a value for arithmetic. `math.to_integer` also accepts booleans.
Use an integer count for `repeat` and `wait`.

The **Math & logic** palette includes absolute value, min/max, square root, power,
natural log, exponential, sine, cosine, tangent, and inverse trig.
Trig takes degrees and inverse trig returns degrees. Use `math.atan2(y, x)`
for a direction angle. `entity.x_real`, `entity.y_real`, `entity.vx_real`,
`entity.vy_real`, and `entity.health_real` retain fractional values.

```ruby
on tick
  change local_real.angle by 3
  if entity.is_player and button.right
    move_by(1.5, math.sin(local_real.angle))
  end
end
```

## Entity tags

Use the searchable pickers in the **Entities** palette. Entity lookups take
the selected instance name. Tag lookups take the selected tag name.
Target sockets start with a searchable entity lookup and can also
accept a computed result. Use **Game → Variables → Add entity field** to name
a new field and make it available in the pickers. Older scripts can still use
the actor prefix for entity readings.

Add tags such as `enemy`, `patrol`, or `pickup` in **Entities** to use them
for every placement of that type. Add a tag in **Room → Placed entities**
to use it on one placement. Scripts can also query built-in tags such as
`transform`, `sprite`, and `health`. Actors with physics, player input, or
scripts expose `body`, `player`, or `script` respectively.

Open **Entities** in the block palette to find an entity by its instance name
or find the nearest other entity with a tag. Entity IDs are valid within
the current room. A query returns 0 if it finds no match. Check an ID with
`entity.exists` before using it later. Entity writes affect the selected
entity’s typed local variables, so another entity can set a value your own script
reads with `local`, `local_real`, `local_bool`, or `local_string`.

```ruby
on tick
  local.target = entity.nearest("enemy", 96)
  if pressed.x and entity.exists(local.target)
    add_component(local.target, "alerted")
    set_entity_real(local.target, "speed", 2.5)
    damage_entity(local.target, 1)
    animate_once("attack")
  end
end

on animation_finished
  animate("idle")
end
```

Use **Play animation once** for a clip that should stop on its last frame.
The completion event also fires when a finite clip reaches the end of its
configured repeats.

## Respawn rules

Set **Respawn** for a single placement under **Room → Placed entities → Spawning and room visits**. Use **Never** to
keep a defeated instance absent, **On room re-entry** to reset it when the
player returns, or **After a delay** to respawn after a number of game ticks.
A delayed respawn can also wait for a flag to reach a chosen value.

The Entities palette has **Set entity respawn** and **Entity respawns when**
blocks for changing these rules from a script. Set the rule while the entity
is present. Pending respawns are carried in saved games.

Persistent particle emitters preserve their emission phase when a script
sets the same effect each tick. The **Appearance** palette also supports
timed emitters and bursts at an offset. Emission is shared between active
entities when the room hits its particle budget.

## Game menus

Create named menus in **Game → Menus**. Open a menu with `show_menu("pause")`
or open the starting menu from a starting room entity’s `on start` event.
Use Up and Down to highlight an option, A to select it, or B to cancel.
The room is paused while a menu is open.

Handle `on menu_selected` and read `entity.menu_id` and `entity.menu_choice`.
Choices start at 1. Cancel returns 0. Menu labels can use a `text.key` from
**Game → Text**. Use **Collections** to author inventories and item properties.

## Text and languages

In **Game → Text**, add the default language, add a text key, then fill translations
in the other language tables. Use a **Text key** reporter in Blocks or
`text.greeting` in WaffleScript. Dialogue and HUD labels accept strings built
from literals, variables, and keys.

```ruby
on start
  say(text.greeting)
end
```

Open **File → Export…**, choose a format and language, then export once per
language. Each playable export contains the selected text table with missing
entries filled from the default language. The editable project keeps all
translation tables.

The built-in bitmap font includes common accented Latin letters. For other
glyphs, import a custom 96-pixel-wide font sheet. Place extra glyphs after the
96 ASCII cells and list those characters in sheet order in **Game → Display**.
Each row contains 16 cells of 6 × 8 pixels.

## Modules and routines

Select **New module**. Enter a name such as `score`. Define a function in
the module. A function returns one expression and takes up to two parameters. Parameters
default to integers. Annotate other types with `: real`, `: boolean`,
or `: string`, as in `def wave(angle: real)`.

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

on tick
  if pressed.b
    award()
  end
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
| `scripts/sprites/` | One CBOR script per entity |
| `scripts/modules/` | Shared WaffleScript modules with the .ws extension |

A sprite can use a .ws file as its source. Set its script path in project.json.
Keep one source per sprite. Studio reads and writes that source in either view.
A folder project and a .waffleproj archive use the same paths.

## Desktop export and updates

Open **File → Export…** and select **Linux game** or **Windows game**.
Extract the ZIP. Keep the player and game.waffle together. Start the player.
The game uses the runtime in its folder.

The desktop edition of Studio includes the runtime for its platform. To get
the runtime for another platform, select **Tools → Updates**. Select
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


### Item effects

Read `entity.used_item` in an `on use_item` handler to apply an item’s effect. **Item reference** provides a searchable item picker in Blocks. In WaffleScript, compare with `item_key("potion")`.

```ruby
on use_item
  if entity.used_item == item_key("potion")
    flag.potion_used = true
  end
end
```
