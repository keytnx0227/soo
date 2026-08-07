const BLOCK_SEPARATOR = '\n\n';
const ENTRY_SEPARATOR = '\n\n';

export function composeAtomicContext(sourceBlocks, budget, countTokens) {
    const workingBlocks = sourceBlocks.map(block => ({ ...block, units: [...block.units] }));
    const full = renderBlocks(workingBlocks);
    const originalTokenCount = countTokens(full);
    const omittedUnits = [];

    for (const block of workingBlocks) {
        if (!block.enabled || !Number.isFinite(block.unitBudget)) continue;
        while (block.units.length && countTokens(renderBlock(block)) > block.unitBudget) {
            const unitIndex = findLowestPriorityUnitIndex(block.units);
            const [unit] = block.units.splice(unitIndex, 1);
            omittedUnits.push({ kind: block.kind, name: block.name, reason: 'block-budget', ...unit });
        }
    }

    if (Number.isFinite(budget)) {
        while (countTokens(renderBlocks(workingBlocks)) > budget) {
            const ordinaryRetrievedBlock = workingBlocks.find(candidate => (
                candidate.enabled && candidate.units.some(unit => unit.retrieved && !unit.pinned)
            ));
            const retrievedBlock = ordinaryRetrievedBlock || workingBlocks.find(candidate => (
                candidate.enabled && candidate.units.some(unit => unit.retrieved)
            ));
            const block = retrievedBlock || workingBlocks.find(candidate => candidate.enabled && candidate.units.length);
            if (!block) break;
            const unitIndex = ordinaryRetrievedBlock
                ? block.units.findIndex(unit => unit.retrieved && !unit.pinned)
                : retrievedBlock
                    ? block.units.findIndex(unit => unit.retrieved)
                    : findLowestPriorityUnitIndex(block.units);
            const [unit] = block.units.splice(unitIndex, 1);
            omittedUnits.push({ kind: block.kind, name: block.name, reason: 'total-budget', ...unit });
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
            const sourceContent = source.enabled && source.units.length ? renderBlock(source) : '';
            const outputContent = output?.enabled && output.units.length ? renderBlock(output) : '';
            return {
                kind: source.kind,
                name: source.name,
                enabled: source.enabled,
                budget: source.unitBudget,
                sourceTokenCount: countTokens(sourceContent),
                outputTokenCount: countTokens(outputContent),
                sourceCount: source.units.length,
                outputCount: output?.units.length || 0,
                omittedItems: omitted.map(unit => ({ id: unit.id, label: unit.label })),
            };
        }),
    };
}

function findLowestPriorityUnitIndex(units) {
    let lowestIndex = 0;
    let lowestPriority = Number(units[0]?.priority) || 0;
    for (let index = 1; index < units.length; index++) {
        const priority = Number(units[index]?.priority) || 0;
        if (priority >= lowestPriority) continue;
        lowestIndex = index;
        lowestPriority = priority;
    }
    return lowestIndex;
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
