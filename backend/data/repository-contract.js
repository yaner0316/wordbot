const REQUIRED_REPOSITORIES = {
    accounts: ['findByUserId', 'create', 'updateCredentials'],
    users: ['list', 'getSettings', 'updateSettings'],
    words: ['listByUser', 'findByUserAndWord', 'findByRecordId', 'create', 'createMany', 'update', 'delete'],
    tests: ['listByUser', 'findByTestId', 'createMany', 'update'],
    reviews: ['listByUser', 'createMany', 'update'],
    questionCache: ['list', 'createMany', 'markUsed'],
    stats: ['findByUser', 'listAll', 'upsert'],
    maintenance: ['deleteUserTestData', 'audit'],
};

function assertRepositoryShape(repositories) {
    for (const [domain, methods] of Object.entries(REQUIRED_REPOSITORIES)) {
        const repository = repositories?.[domain];
        if (!repository || typeof repository !== 'object') {
            throw new Error(`Missing repository domain: ${domain}`);
        }
        for (const method of methods) {
            if (typeof repository[method] !== 'function') {
                throw new Error(`Missing repository method: ${domain}.${method}`);
            }
        }
    }
    return repositories;
}

module.exports = {
    REQUIRED_REPOSITORIES,
    assertRepositoryShape,
};
