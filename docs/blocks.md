# WaffleScript engine commands

| Command | Block | Opcode |
| --- | --- | --- |
| `animate(tag)` | Play animation tag | 7 |
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
| `follow()` | Follow this sprite | 23 |
| `give(item, count)` | Give item × count | 18 |
| `give_player(item, player, count)` | Give item to player player count count | 34 |
| `group_camera()` | Follow all players | 30 |
| `hide(label)` | Hide counter label | 22 |
| `jump(speed)` | Jump at speed | 1 |
| `release_camera()` | Follow player 1 | 25 |
| `remove_self()` | Remove this instance | 26 |
| `retry_checkpoint()` | Return to checkpoint | 32 |
| `room(room)` | Go to room room | 8 |
| `say(text)` | Say text | 20 |
| `sound(sound)` | Play sound sound | 5 |
| `spawn(sprite, x, y)` | Add instance of sprite at offset X x Y y | 9 |
| `stop_fx()` | Stop particle emitter | 29 |
| `take(item, count)` | Remove item × count | 19 |
| `take_player(item, player, count)` | Take item from player player count count | 35 |
| `velocity(x, y)` | Set velocity x x y y | 6 |
| `walk(speed)` | Move with D-pad at speed | 0 |

## Events

`start`, `restored`, `tick`, `a`, `b`, `x`, `menu`, `begin_contact`, `end_contact`, `damage`, `destroy`

## Actor readings

`actor.id`, `actor.x`, `actor.y`, `actor.vx`, `actor.vy`, `actor.health`, `actor.grounded`, `actor.player`, `actor.other`, `actor.damage`, `actor.other_player`, `actor.last_spawn`, `actor.answer`, `actor.item_count`
