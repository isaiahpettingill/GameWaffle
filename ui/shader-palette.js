import {shaderNodes} from '../src/shader-graph.mjs';

const descriptions={
  Scene:{
    screen:'Read the previous shader pass or room at the given UV coordinates.',
    uv:'Get the normalized position of this pixel. The top-left corner is (0, 0).',
    time:'Get elapsed simulation time in seconds to animate the effect.',
    resolution:'Get the width and height of the current pass in pixels.',
  },
  Values:{
    float:'Set a single numeric value.',
    vec2:'Set a two-component vector for positions, offsets, or directions.',
    color:'Pick a fixed RGB color.',
    boolean:'Set true or false for a Select node.',
    parameter:'Expose a named number that room and game scripts can set.',
    vector_parameter:'Expose a named two-component vector to room and game scripts.',
    color_parameter:'Expose a named color to room and game scripts.',
  },
  Math:{
    add:'Add values together. Use it to offset a position or brighten a color.',
    subtract:'Subtract B from A. Use it to measure a difference or center coordinates.',
    multiply:'Scale a value or multiply two values component by component.',
    divide:'Divide A by B. Useful for scaling coordinates or finding a ratio.',
    modulo:'Wrap a value at an interval to make a repeating pattern.',
    min:'Keep the smaller value for each component.',
    max:'Keep the larger value for each component.',
    pow:'Raise A to the power B to reshape a curve.',
    sin:'Produce a smooth repeating wave from an angle in radians.',
    cos:'Produce a repeating wave that starts at its highest point.',
    abs:'Return the distance from zero.',
    sqrt:'Take the square root of a nonnegative value.',
    floor:'Round down to the next whole number.',
    fract:'Keep the fractional part to repeat a signal between 0 and 1.',
  },
  Blending:{
    mix:'Blend From and To using an amount from 0 to 1.',
    clamp:'Keep a value between a minimum and a maximum.',
    step:'Return 0 below the edge and 1 at or above it.',
    smoothstep:'Fade smoothly from 0 to 1 between two thresholds.',
    luminance:'Convert a color into a brightness value using weighted RGB components.',
    noise:'Generate a smooth irregular pattern from UV coordinates.',
  },
  Vectors:{
    combine:'Build a two-component vector from X and Y.',
    rgba:'Build a color from red, green, blue, and alpha channels.',
    x:'Read the first component of a vector or the red channel of a color.',
    y:'Read the second component of a vector or the green channel of a color.',
    z:'Read the blue channel of a color.',
    w:'Read the alpha channel of a color.',
    length:'Measure the length of a vector or the magnitude of a color.',
    normalize:'Keep a vector’s direction and give it a length of 1.',
    dot:'Multiply matching vector components and add them together.',
  },
  Logic:{
    less:'Return true when A is less than B.',
    select:'Choose one value when the condition is true and another when it is false.',
  },
};

export const shaderPalette=Object.entries(descriptions).flatMap(([category,nodes])=>
  Object.entries(nodes).map(([kind,description])=>({kind,label:shaderNodes[kind].label,category,description})));
