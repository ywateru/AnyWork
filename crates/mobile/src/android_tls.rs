//! Initialize reqwest's Android trust verifier before any native HTTP request.

pub fn init() -> Result<(), jni::errors::Error> {
    // Tao initializes ndk-context with a process-lifetime Application global
    // reference before invoking the mobile entry point. Do not retain an Activity.
    let context = ndk_context::android_context();
    // SAFETY: both pointers are owned by Tao and remain valid for this process.
    let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) };
    // The Rust entry thread need not already be attached to the JVM.
    vm.attach_current_thread_for_scope(|env| {
        // Borrow Tao's global reference without taking ownership, then make a
        // local copy. init_with_env retains its own context/classloader globals.
        let raw = context.context().cast();
        let application = unsafe { env.as_cast_raw::<jni::objects::JObject>(&raw)? };
        let application = env.new_local_ref(&*application)?;
        rustls_platform_verifier::android::init_with_env(env, application)
    })
}
