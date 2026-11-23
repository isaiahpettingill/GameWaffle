// Load the core in a separate process. The APK supplies no libraries to this process.
#include <dlfcn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

struct game_info { const char *path; const void *data; size_t size; const char *meta; };
static unsigned frames, audible_frames, ports;
static bool environment(unsigned command, void *data) {
    return (command == 10 && *(int *)data == 1) || command == 11 || command == 44;
}
static void video(const void *data, unsigned w, unsigned h, size_t pitch) {
    if (data && w >= 128 && w <= 512 && h >= 128 && h <= 512 && pitch >= w*4) {
        const uint32_t *row = data;
        for (unsigned y=0; y<h; ++y) {
            for (unsigned x=0; x<w; ++x) {
                if (row[x] != *(const uint32_t *)data) { ++frames; return; }
            }
            row = (const uint32_t *)((const char *)row + pitch);
        }
    }
}
static size_t audio(const int16_t *data, size_t count) {
    for (size_t i=0; i<count*2; ++i) if (data[i]) { ++audible_frames; break; }
    return count;
}
static int16_t input(unsigned port, unsigned device, unsigned index, unsigned id) {
    (void)index;
    if (port < 4 && device == 1) ports |= 1u << port;
    return port == 0 && id == 7;
}
int main(int argc, char **argv) {
    if (argc != 3) return 1;
    setbuf(stdout, NULL);
    puts("Load the core library");
    void *lib = dlopen(argv[1], RTLD_NOW|RTLD_LOCAL);
    if (!lib) { fprintf(stderr,"%s\n",dlerror()); return 1; }
    FILE *cart = fopen(argv[2], "rb");
    if (!cart || fseek(cart,0,SEEK_END)) return 1;
    long length=ftell(cart); rewind(cart);
    if (length<1) return 1;
    void *bytes=malloc((size_t)length);
    if (!bytes || fread(bytes,1,length,cart)!=(size_t)length) return 1;
    fclose(cart);
#define BIND(ret, name, args) ret (*name) args = dlsym(lib,#name); if (!name) return 1
    BIND(void,retro_set_environment,(__typeof__(&environment)));
    BIND(void,retro_set_video_refresh,(__typeof__(&video)));
    BIND(void,retro_set_input_state,(__typeof__(&input)));
    BIND(void,retro_set_audio_sample_batch,(__typeof__(&audio)));
    BIND(void,retro_init,(void));
    BIND(bool,retro_load_game,(const struct game_info *));
    BIND(void,retro_run,(void));
    BIND(void,retro_unload_game,(void));
    BIND(void,retro_deinit,(void));
    retro_set_environment(environment); retro_set_video_refresh(video);
    retro_set_audio_sample_batch(audio); retro_set_input_state(input); retro_init();
    struct game_info info={NULL,bytes,(size_t)length,NULL};
    puts("Load the cartridge");
    if (!retro_load_game(&info)) return 1;
    puts("Run 120 frames");
    for (unsigned i=0;i<120;++i) retro_run();
    puts("Unload the cartridge");
    retro_unload_game(); retro_deinit(); free(bytes); dlclose(lib);
    printf("%u frames, %u audible frames, ports %x\n",frames,audible_frames,ports);
    return !(frames==120 && audible_frames && ports==15);
}
