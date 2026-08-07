const BLOCK_SEPARATOR = '\n\n';
const ENTRY_SEPARATOR = '\n\n';

export function composeAtomicContext(sourceBlocks, budget, countTokens) {
    const workingBlocks = sourceBlocks.map(block => ({ ...block, units: [...block.units] }));
    const full = renderBlocks(workingBlocks);
    const originalTokenCount = countTokens(full);
    const omittedUnits = [];

    if (Number.isFinite(budget)) {
        while (countTokens(renderBlocks(workingBlocks)) > budget) {
            const retrievedBlock = workingBlocks.find(candidate => (
                candidate.enabled && candidate.units.some(unit => unit.retrieved)
            ));
            const block = retrievedBlock || workingBlocks.find(candidate => candidate.enabled && candidate.units.length);
            if (!block) break;
            const unitIndex = retrievedBlock ? block.units.findIndex(unit => unit.retrieved) : 0;
            const [unit] = block.units.splice(unitIndex, 1);
            omittedUnits.push({ kind: block.kind, name: block.name, ...unit });
        }
    }

    const content = renderBlocks(workingBlocks);
    return {
        content,
        budget,
        originalTokenCount,
        outputTokenCount: countTokens(content),
        truncated: omittedUnits.length > 0,
        sourceUnitCount: sourceBlocks.filter(block => block.enabled).reduce((sum, block) => sum + block.units.length, 0),
        omittedUnits,
        blocks: sourceBlocks.map(source => {
            const output = workingBlocks.find(block => block.kind === source.kind);
            const omitted = omittedUnits.filter(unit => unit.kind === source.kind);
            return {
                kind: source.kind,
                name: source.name,
                enabled: source.enabled,
                sourceCount: source.units.length,
                outputCount: output?.units.length || 0,
                omittedItems: omitted.map(unit => ({ id: unit.id, label: unit.label })),
            };
        }),
    };
}

function renderBlocks(blocks) {
    return blocks
        .filter(block => block.enabled && block.units.length)
        .map(renderBlock)
        .filter(Boolean)
        .join(BLOCK_SEPARATOR);
}

function renderBlock(block) {
    return [
        String(block.prefixTemplate || '').trim(),
        block.units.map(unit => unit.content).filter(Boolean).join(ENTRY_SEPARATOR),
        String(block.suffixTemplate || '').trim(),
    ].filter(Boolean).join(ENTRY_SEPARATOR);
}
