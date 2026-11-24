# WaffleScript engine commands

| Command | Block | Opcode |
| --- | --- | --- |
| `add_component(entity, component)` | Add component component to entity entity | 58 |
| `animate(tag)` | Play animation tag | 7 |
| `animate_once(tag)` | Play animation tag once | 55 |
| `apply_gravity(modifier)` | Apply gravity with modifier modifier | 43 |
| `ask(text)` | Ask yes or no text | 33 |
| `bar(label, value, maximum)` | Show bar label value value maximum maximum | 37 |
| `break_entity(entity)` | Break entity entity | 91 |
| `burst(effect, count)` | Burst effect with count particles | 27 |
| `burst_at(effect, x, y)` | Burst effect at X x Y y offset | 68 |
| `camera(x, y)` | Point camera at X x Y y | 24 |
| `camera_follow_entity(entity)` | Follow entity entity | 74 |
| `camera_zoom(zoom)` | Set camera zoom to zoom× | 75 |
| `chase(speed)` | Find path to nearest player at speed speed | 4 |
| `checkpoint()` | Set checkpoint | 31 |
| `count_player(item, player)` | Read item count for player player | 36 |
| `counter(label, value)` | Show counter label with value value | 21 |
| `damage(amount, range, height)` | Deal amount damage in a range × height attack box | 2 |
| `damage_entity(entity, amount)` | Damage entity entity by amount | 53 |
| `draw_text(label, value, font, anchor, x, y)` | Draw HUD text value named label in font at anchor with X x Y y | 85 |
| `emit(effect, rate)` | Emit effect at rate per second | 28 |
| `emit_event(event)` | Emit event event | 84 |
| `emit_for(effect, rate, ticks)` | Emit effect at rate per second for ticks ticks | 67 |
| `entity_velocity(entity, x, y)` | Set entity entity velocity X x Y y | 52 |
| `fire(aim, speed, amount)` | Fire aim at speed speed with amount damage | 3 |
| `fire_projectile(projectile, aim, speed, amount)` | Fire projectile toward aim at speed speed with amount damage | 73 |
| `flip_sprite_x(enabled)` | Flip sprite horizontally enabled | 69 |
| `flip_sprite_y(enabled)` | Flip sprite vertically enabled | 70 |
| `follow()` | Follow this instance | 23 |
| `follow_player(player)` | Follow player player | 40 |
| `force(x, y)` | Apply force X x Y y N | 44 |
| `give(item, count)` | Give item × count | 18 |
| `give_player(item, player, count)` | Give item to player player count count | 34 |
| `group_camera()` | Follow all players | 30 |
| `heal_entity(entity, amount)` | Heal entity entity by amount | 89 |
| `hide(label)` | Hide HUD element label | 22 |
| `impulse(x, y)` | Apply impulse X x Y y N·s | 45 |
| `item_icon(item, x, y)` | Draw item item at X x Y y | 39 |
| `jump(speed)` | Jump at speed speed | 1 |
| `jump_force(force)` | Jump with force force N | 42 |
| `move_by(x, y)` | Move by X x Y y | 46 |
| `move_entity(entity, x, y)` | Move entity entity by X x Y y | 51 |
| `push_entity(entity, x, y)` | Push entity entity with impulse X x Y y | 90 |
| `release_camera()` | Follow player 1 | 25 |
| `remove_component(entity, component)` | Remove component component from entity entity | 59 |
| `remove_entity(entity)` | Remove entity entity | 54 |
| `remove_self()` | Remove this instance | 26 |
| `reset_room_camera()` | Reset room camera | 81 |
| `reset_room_shader()` | Reset room shader | 83 |
| `respawn_when(entity, flag, when)` | Entity entity respawns when flag is when | 66 |
| `retry_checkpoint()` | Return to checkpoint | 32 |
| `room(room)` | Go to room room | 8 |
| `rotate_sprite(degrees)` | Rotate sprite by degrees° | 72 |
| `say(text)` | Say text | 20 |
| `set_entity_boolean(entity, field, value)` | Set entity entity boolean field to value | 62 |
| `set_entity_integer(entity, field, value)` | Set entity entity integer field to value | 60 |
| `set_entity_real(entity, field, value)` | Set entity entity real field to value | 61 |
| `set_entity_string(entity, field, value)` | Set entity entity string field to value | 63 |
| `set_health_bar(enabled, fill, track)` | Show health bar enabled with fill fill and background track | 88 |
| `set_hud_font(font)` | Set HUD font to font | 86 |
| `set_position(x, y)` | Go to X x Y y | 41 |
| `set_respawn(entity, mode, ticks)` | Set entity entity respawn to mode, delay ticks ticks | 65 |
| `set_room_ambience(sound)` | Set room ambience to sound | 80 |
| `set_room_background(color)` | Set room background color to color | 77 |
| `set_room_depth_sort(enabled)` | Sort entities by depth enabled | 78 |
| `set_room_gravity(gravity)` | Set room gravity to gravity | 76 |
| `set_room_music(sound)` | Set room music to sound | 79 |
| `set_room_shader(shader, strength)` | Set room shader to shader at strength% strength | 82 |
| `set_sprite_rotation(degrees)` | Set sprite rotation to degrees° | 71 |
| `set_sprite_shadow(placement, opacity)` | Set sprite shadow to placement at opacity% opacity | 87 |
| `show_inventory()` | Show inventory menu | 57 |
| `show_menu(menu)` | Show menu menu | 56 |
| `sound(sound)` | Play sound sound | 5 |
| `spawn(sprite, x, y)` | Create instance of sprite at offset X x Y y | 9 |
| `stop_fx()` | Stop particle emitter | 29 |
| `take(item, count)` | Remove item × count | 19 |
| `take_player(item, player, count)` | Take item from player player count count | 35 |
| `use_player_item(item, player)` | Use item for player player | 38 |
| `use_selected_item()` | Use selected inventory item | 64 |
| `velocity(x, y)` | Set velocity x x y y | 6 |
| `walk(speed)` | Move with D-pad at speed | 0 |

## Events

`start`, `use_item`, `restored`, `tick`, `a`, `b`, `x`, `menu`, `begin_contact`, `end_contact`, `damage`, `destroy`, `animation_finished`, `menu_selected`

Use `pressed.name` or `released.name` for an input action. Read `action.name` to test whether a control for that action is held.

## Entity readings

`entity.id`, `entity.x`, `entity.y`, `entity.vx`, `entity.vy`, `entity.health`, `entity.grounded`, `entity.player`, `entity.other`, `entity.damage`, `entity.other_player`, `entity.last_spawn`, `entity.answer`, `entity.item_count`, `entity.moving`, `entity.is_player`, `entity.facing`, `entity.menu_choice`, `entity.event_sender`, `entity.x_real`, `entity.y_real`, `entity.vx_real`, `entity.vy_real`, `entity.health_real`, `entity.menu_item`, `entity.menu_id`, `entity.used_item`
