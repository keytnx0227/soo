import { ATLAS_LAYER_CATEGORIES, buildAtlasLayers, resolveAtlasLayerOrder, reanchorAtlasLayers } from './atlas-layer-order.js';

// Capture before mutation; apply immediately before the existing save and rollback with its owner.
export function captureAtlasAnchors(root, readRecords) {
    const original = root.atlas?.layerOrders;
    const categories = ATLAS_LAYER_CATEGORIES.filter(category => Array.isArray(original?.[category]) && original[category].length);
    if (!categories.length) return { apply() {}, rollback() {} };
    const previous = structuredClone(original);
    const inventory = (category, records) => buildAtlasLayers(category, { records,
        reviews: root.atlas.reviews || [], manual: root.atlas.manual?.[category] || [], corrections: root.atlas.corrections?.[category] || {} });
    const beforeRecords = readRecords();
    const before = new Map(categories.map(category => [category, resolveAtlasLayerOrder(inventory(category, beforeRecords), previous[category])]));
    let applied = null;
    return {
        apply() {
            const records = readRecords();
            const next = structuredClone(root.atlas.layerOrders || {});
            let changed = false;
            for (const category of categories) {
                const remaining = inventory(category, records);
                const live = new Set(remaining.map(layer => layer.id));
                if (!before.get(category).some(layer => !live.has(layer.id))) continue;
                next[category] = reanchorAtlasLayers(before.get(category), remaining, previous[category]);
                changed = true;
            }
            if (changed) { root.atlas.layerOrders = next; applied = next; }
        },
        rollback() { if (applied && root.atlas.layerOrders === applied) root.atlas.layerOrders = previous; },
    };
}
