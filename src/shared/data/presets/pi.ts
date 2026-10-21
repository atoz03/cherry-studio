/**
 * The "Pi" provider stands for the user's local pi CLI. It is agent-only (`authMethods:
 * ['external-cli']`): Pi agents run `pi --mode rpc`, and pi itself holds the credentials. Its model
 * list is read from pi (`get_available_models`), plus {@link PI_DEFAULT_MODEL_ID}.
 */
export const PI_PROVIDER_ID = 'pi' as const

/** Leaves the model to pi: the session's last model, else pi's configured default. */
export const PI_DEFAULT_MODEL_ID = 'default' as const
