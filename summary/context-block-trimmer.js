const BLOCK_SEPARATOR = '\n\n';
const ENTRY_SEPARATOR = '\n\n';

export function composeAtomicContext(sourceBlocks, budget, countTokens) {
    const workingBlocks = sourceBlocks.map(block => ({ ...block, units: [...block.units] }));
    const full = renderBlocks(workingBlocks);
    const originalTokenCount = countTokens(full);
    const omittedUnits = [];

    for (let blockIndex = 0; blockIndex < workingBlocks.length; blockIndex++) {
        const block = workingBlocks[blockIndex];
        if (!block.enabled || !Number.isFinite(block.unitBudget)) continue;

        const removalPlan = createPriorityRemovalPlan(block, blockIndex);
        const removalCount = findRemovalCount(
            removalPlan,
            block.unitBudget,
            countTokens,
            count => renderBlockWithoutRemovals(block, removalPlan, count),
        );
        for (const { unit } of removalPlan.slice(0, removalCount)) {
            omittedUnits.push({ kind: block.kind, name: block.name, reason: 'block-budget', ...unit });
        }
        applyRemovalPlan(workingBlocks, removalPlan, removalCount);
    }

    if (Number.isFinite(budget)) {
        const removalPlan = createTotalRemovalPlan(workingBlocks);
        const removalCount = findRemovalCount(
            removalPlan,
            budget,
            countTokens,
            count => renderBlocksWithoutRemovals(workingBlocks, removalPlan, count),
        );
        for (const { blockIndex, unit } of removalPlan.slice(0, removalCount)) {
            const block = workingBlocks[blockIndex];
            omittedUnits.push({ kind: block.kind, name: block.name, reason: 'total-budget', ...unit });
        }
        applyRemovalPlan(workingBlocks, removalPlan, removalCount);
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

function createPriorityRemovalPlan(block, blockIndex) {
    return block.units
        .map((unit, unitIndex) => ({ blockIndex, unitIndex, unit }))
        .sort((left, right) => (
            getUnitPriority(left.unit) - getUnitPriority(right.unit)
            || left.unitIndex - right.unitIndex
        ));
}

function createTotalRemovalPlan(blocks) {
    const plan = [];
    const plannedUnits = new Set();

    const addMatchingUnits = predicate => {
        blocks.forEach((block, blockIndex) => {
            if (!block.enabled) return;
            block.units.forEach((unit, unitIndex) => {
                const unitKey = `${blockIndex}:${unitIndex}`;
                if (plannedUnits.has(unitKey) || !predicate(unit)) return;
                plan.push({ blockIndex, unitIndex, unit });
                plannedUnits.add(unitKey);
            });
        });
    };

    // Match the former loop's phases: ordinary recalls, pinned recalls, then low-priority units.
    addMatchingUnits(unit => unit.retrieved && !unit.pinned);
    addMatchingUnits(unit => unit.retrieved);
    blocks.forEach((block, blockIndex) => {
        if (!block.enabled) return;
        createPriorityRemovalPlan(block, blockIndex).forEach(candidate => {
            const unitKey = `${candidate.blockIndex}:${candidate.unitIndex}`;
            if (plannedUnits.has(unitKey)) return;
            plan.push(candidate);
            plannedUnits.add(unitKey);
        });
    });

    return plan;
}

function findRemovalCount(removalPlan, budget, countTokens, renderAtCount) {
    const tokenCounts = new Map();
    const getTokenCount = count => {
        if (!tokenCounts.has(count)) tokenCounts.set(count, countTokens(renderAtCount(count)));
        return tokenCounts.get(count);
    };

    if (getTokenCount(0) <= budget || !removalPlan.length) return 0;

    let low = 1;
    let high = removalPlan.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (getTokenCount(middle) <= budget) high = middle;
        else low = middle + 1;
    }

    // Token boundaries can shift after deletion, so verify the boundary found by binary search.
    while (low < removalPlan.length && getTokenCount(low) > budget) low++;
    while (low > 0 && getTokenCount(low - 1) <= budget) low--;
    return low;
}

function renderBlockWithoutRemovals(block, removalPlan, removalCount) {
    const removedIndexes = new Set(removalPlan.slice(0, removalCount).map(candidate => candidate.unitIndex));
    return renderBlock({ ...block, units: block.units.filter((_, index) => !removedIndexes.has(index)) });
}

function renderBlocksWithoutRemovals(blocks, removalPlan, removalCount) {
    const removedByBlock = getRemovedUnitsByBlock(removalPlan, removalCount);
    return renderBlocks(blocks.map((block, blockIndex) => ({
        ...block,
        units: removedByBlock.has(blockIndex)
            ? block.units.filter((_, unitIndex) => !removedByBlock.get(blockIndex).has(unitIndex))
            : block.units,
    })));
}

function applyRemovalPlan(blocks, removalPlan, removalCount) {
    const removedByBlock = getRemovedUnitsByBlock(removalPlan, removalCount);
    removedByBlock.forEach((removedIndexes, blockIndex) => {
        blocks[blockIndex].units = blocks[blockIndex].units.filter((_, unitIndex) => !removedIndexes.has(unitIndex));
    });
}

function getRemovedUnitsByBlock(removalPlan, removalCount) {
    const removedByBlock = new Map();
    for (const { blockIndex, unitIndex } of removalPlan.slice(0, removalCount)) {
        if (!removedByBlock.has(blockIndex)) removedByBlock.set(blockIndex, new Set());
        removedByBlock.get(blockIndex).add(unitIndex);
    }
    return removedByBlock;
}

function getUnitPriority(unit) {
    return Number(unit?.priority) || 0;
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
