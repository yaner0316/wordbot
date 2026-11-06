function createSupabaseMirrorClient({
    url = process.env.STAGE1_SUPABASE_URL || process.env.SUPABASE_URL,
    serviceRoleKey = process.env.STAGE1_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl = fetch,
} = {}) {
    if (!url) throw new Error('Missing STAGE1_SUPABASE_URL or SUPABASE_URL');
    if (!serviceRoleKey) throw new Error('Missing STAGE1_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY');
    const baseUrl = url.replace(/\/+$/, '');
    async function request(path, options = {}) {
        const response = await fetchImpl(baseUrl + path, {
            ...options,
            headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey, 'Content-Type': 'application/json', ...(options.headers || {}) },
        });
        if (!response.ok) throw new Error('Supabase request failed ' + response.status + ': ' + await response.text());
        return response.status === 204 ? null : response.json();
    }
    return {
        upsert: (table, rows, conflictKey) => request('/rest/v1/' + table + '?on_conflict=' + encodeURIComponent(conflictKey), {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows),
        }),
        select: (table, columns = '*', { limit = 1000, offset = 0 } = {}) => request('/rest/v1/' + table + '?select=' + encodeURIComponent(columns) + '&limit=' + encodeURIComponent(limit) + '&offset=' + encodeURIComponent(offset), { method: 'GET' }),
    };
}
module.exports = { createSupabaseMirrorClient };
