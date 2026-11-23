on tick
  chase(1)
  bar("Guardian", actor.health, 12)
end

on damage
  if actor.health <= 0
    give_player("pump_key", actor.other_player, 1)
    flag.guardian_defeated = true
    hide("Guardian")
    burst("sparks", 32)
  end
end
