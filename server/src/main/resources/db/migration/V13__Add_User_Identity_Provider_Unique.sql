ALTER TABLE user_identity_bindings
    ADD CONSTRAINT uk_user_identity_bindings_user_provider UNIQUE (user_id, provider);
