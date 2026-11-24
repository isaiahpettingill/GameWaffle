fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android")
        && std::env::var_os("CARGO_FEATURE_LIBRETRO").is_some()
    {
        println!("cargo:rustc-cdylib-link-arg=-Wl,--wrap=Android_WaitActiveAndLockActivity");
        println!("cargo:rustc-cdylib-link-arg=-Wl,--wrap=Android_UnlockActivityMutex");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=player.rc");
        println!("cargo:rerun-if-changed=../studio/icons/icon.ico");
        embed_resource::compile_for("player.rc", ["gamewaffle-player"], embed_resource::NONE)
            .manifest_required()
            .expect("Compile the player icon");
    }
}
