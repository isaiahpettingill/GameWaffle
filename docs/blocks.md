# WaffleScript engine commands

| Command | Block | Opcode |
| --- | --- | --- |
| `animate(tag)` | Play animation tag | 7 |
| `apply_gravity(modifier)` | Apply gravity with modifier modifier | 43 |
| `ask(text)` | Ask yes or no text | 33 |
| `bar(label, value, maximum)` | Show bar label value value maximum maximum | 37 |
| `burst(effect, count)` | Burst effect with count particles | 27 |
| `camera(x, y)` | Point camera at X x Y y | 24 |
| `chase(speed)` | Find path to nearest player at speed speed | 4 |
| `checkpoint()` | Set checkpoint | 31 |
| `count_player(item, player)` | Read item count for player player | 36 |
| `counter(label, value)` | Show counter label with value value | 21 |
| `damage(amount, range, height)` | Deal amount damage in a range × height attack box | 2 |
| `emit(effect, rate)` | Emit effect at rate per second | 28 |
| `fire(aim, speed, amount)` | Fire aim at speed speed with amount damage | 3 |
| `follow()` | Follow this instance | 23 |
| `follow_player(player)` | Follow player player | 40 |
| `force(x, y)` | Apply force X x Y y N | 44 |
| `give(item, count)` | Give item × count | 18 |
| `give_player(item, player, count)` | Give item to player player count count | 34 |
| `group_camera()` | Follow all players | 30 |
| `hide(label)` | Hide counter label | 22 |
| `impulse(x, y)` | Apply impulse X x Y y N·s | 45 |
| `item_icon(item, x, y)` | Draw item item at X x Y y | 39 |
| `jump(speed)` | Jump at speed speed | 1 |
| `jump_force(force)` | Jump with force force N | 42 |
| `release_camera()` | Follow player 1 | 25 |
| `remove_self()` | Remove this instance | 26 |
| `retry_checkpoint()` | Return to checkpoint | 32 |
| `room(room)` | Go to room room | 8 |
| `say(text)` | Say text | 20 |
| `set_position(x, y)` | Set position X x Y y | 41 |
| `sound(sound)` | Play sound sound | 5 |
| `spawn(sprite, x, y)` | Create instance of sprite at offset X x Y y | 9 |
| `stop_fx()` | Stop particle emitter | 29 |
| `take(item, count)` | Remove item × count | 19 |
| `take_player(item, player, count)` | Take item from player player count count | 35 |
| `use_player_item(item, player)` | Use item for player player | 38 |
| `velocity(x, y)` | Set velocity x x y y | 6 |
| `walk(speed)` | Move with D-pad at speed | 0 |

## Events

`start`, `use_item`, `restored`, `tick`, `a`, `b`, `x`, `menu`, `begin_contact`, `end_contact`, `damage`, `destroy`

Use `pressed.name` or `released.name` for an input action. Read `action.name` to test whether a control for that action is held.

## Actor readings

`actor.id`, `actor.x`, `actor.y`, `actor.vx`, `actor.vy`, `actor.health`, `actor.grounded`, `actor.player`, `actor.other`, `actor.damage`, `actor.other_player`, `actor.last_spawn`, `actor.answer`, `actor.item_count`
