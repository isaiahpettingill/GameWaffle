import {pixelsPerMeter} from './physics-units.mjs';

export function movementPreset(view,pixelUnits=false) {
  const scale=pixelUnits?pixelsPerMeter:1, speed=4*scale;
  const common = `  if entity.is_player
    local_real.move_x = 0.0
    if action.left
      change local_real.move_x by -${speed}.0
    end
    if action.right
      change local_real.move_x by ${speed}.0
    end`;
  if(view==='top_down')return common+`
    local_real.move_y = 0.0
    if action.up
      change local_real.move_y by -${speed}.0
    end
    if action.down
      change local_real.move_y by ${speed}.0
    end
    velocity(local_real.move_x, local_real.move_y)
  end
`;
  return common+`
    velocity(local_real.move_x, entity.vy_real)
    if pressed.x and entity.grounded
      jump(${8*scale})
    end
  end
`;
}
