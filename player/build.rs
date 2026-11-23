fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=player.rc");
        println!("cargo:rerun-if-changed=../studio/icons/icon.ico");
        embed_resource::compile_for("player.rc", ["gamewaffle-player"], embed_resource::NONE)
            .manifest_required()
            .expect("Compile the player icon");
    }
}
