export const PROMPT_SCOPE_TYPES = Object.freeze({
    GLOBAL: 'global',
    CHARACTER: 'character',
});

export function getCurrentCharacterPromptTarget() {
    const context = SillyTavern.getContext();
    if (context.groupId !== null && context.groupId !== undefined) return null;

    const character = context.characters?.[context.characterId];
    const characterKey = String(character?.avatar || '').trim();
    if (!character || !characterKey || characterKey === 'none') return null;

    return {
        characterKey,
        characterName: String(character.name || context.name2 || '현재 캐릭터').trim(),
    };
}

export function normalizePromptScope(value) {
    if (value?.type !== PROMPT_SCOPE_TYPES.CHARACTER) {
        return { type: PROMPT_SCOPE_TYPES.GLOBAL };
    }

    const characterKey = String(value.characterKey || '').trim();
    if (!characterKey) return { type: PROMPT_SCOPE_TYPES.GLOBAL };
    return {
        type: PROMPT_SCOPE_TYPES.CHARACTER,
        characterKey,
        characterName: String(value.characterName || '캐릭터').trim(),
    };
}

export function isPromptBlockApplicable(block, target = getCurrentCharacterPromptTarget()) {
    const scope = normalizePromptScope(block?.scope);
    if (scope.type === PROMPT_SCOPE_TYPES.GLOBAL) return true;
    return Boolean(target && scope.characterKey === target.characterKey);
}
