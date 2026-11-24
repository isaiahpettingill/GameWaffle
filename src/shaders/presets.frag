#version 450
layout(location = 1) in vec2 uv;
layout(location = 0) out vec4 outputColor;
layout(set = 2, binding = 0) uniform sampler2D screen;
layout(std140, set = 3, binding = 0) uniform Parameters {
    vec2 resolution;
    float time;
    float delta_time;
    int preset;
    float strength;
    float spacing;
    float speed;
    vec3 tint;
    float radius;
} params;

float noise(vec2 p) {
    return fract(sin(dot(p,vec2(12.9898,78.233))) * 43758.5453);
}

void main() {
    vec2 at = uv;
    float amount = clamp(params.strength / 100.0, 0.0, 1.0);
    float spacing = max(2.0, params.spacing);
    if (params.preset == 4)
        at.x += sin(6.2831853 * (uv.y * params.resolution.y / spacing + params.time * params.speed))
            * (12.0 * amount / max(1.0,params.resolution.x));
    vec4 color = texture(screen, at);
    vec2 pixel = floor(uv * params.resolution);
    float coverage = 1.0;
    if (params.preset == 1) {
        coverage = step(spacing - 1.0, mod(pixel.y,spacing));
    } else if (params.preset == 2) {
        coverage = max(step(spacing - 1.0, mod(pixel.y,spacing)),step(spacing - 1.0,mod(pixel.x,spacing)));
    } else if (params.preset == 3) {
        coverage = smoothstep(clamp(params.radius / 100.0,0.0,0.95), 1.414, length(uv * 2.0 - 1.0));
    } else if (params.preset == 4) {
        coverage = 0.0;
    } else if (params.preset == 5) {
        coverage = 0.14 + 0.70 * smoothstep(0.34,1.0,uv.y + 0.04 * sin(uv.x * 12.0 + params.time * params.speed));
    } else if (params.preset == 6) {
        vec2 light = uv - vec2(0.22 + uv.y * 0.46,0.0);
        coverage = exp(-160.0 * light.x * light.x) * (1.0 - 0.72 * uv.y);
    } else if (params.preset == 7) {
        vec2 delta = uv - vec2(0.25,0.27);
        coverage = 0.7 * exp(-600.0 * dot(delta,delta)) + 0.3 * exp(-90.0 * dot(delta,delta));
    } else if (params.preset >= 8 && params.preset <= 10) {
        vec2 direction = params.preset == 10 ? vec2(12.0,2.0) : params.preset == 9 ? vec2(-2.0,19.0) : vec2(3.0,6.0);
        vec2 p = pixel - direction * floor(params.time * params.speed * 12.0);
        vec2 cell = floor(p / 9.0), detail = mod(p,9.0);
        float seed = noise(cell), start = 2.0 + floor(seed * 4.0);
        coverage = step(0.87,seed) * step(abs(detail.x - start),params.preset == 10 ? 3.0 : 0.5)
            * step(abs(detail.y - start),params.preset == 9 ? 2.0 : 0.5);
    } else if (params.preset == 11) {
        vec2 offset = 0.33 / max(vec2(1.0), params.resolution);
        vec3 smoothed = 0.25*(texture(screen,uv-offset).rgb+texture(screen,uv+offset).rgb
            +texture(screen,uv+vec2(offset.x,-offset.y)).rgb+texture(screen,uv+vec2(-offset.x,offset.y)).rgb);
        outputColor = vec4(mix(color.rgb,smoothed,amount),color.a);
        return;
    }
    outputColor = vec4(mix(color.rgb, params.tint, amount * coverage), color.a);
}
