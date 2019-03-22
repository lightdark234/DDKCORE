export const GET_REFERRED_USERS = 'GET_REFERRED_USERS';
export const GET_REFERRED_USERS_BY_LEVEL = 'GET_REFERRED_USERS_BY_LEVEL';

export const GET_REWARD_HISTORY = 'GET_REWARD_HISTORY';
export const GET_REFERRED_USERS_REWARD = 'GET_REFERRED_USERS_REWARDS';

export const GET_CURRENT_ROUND = 'GET_CURRENT_ROUND';

export const enum API_ACTION_TYPES {
    GET_ACCOUNT = 'GET_ACCOUNT',
    GET_ACCOUNT_BALANCE = 'GET_ACCOUNT_BALANCE',

    CREATE_TRANSACTION = 'CREATE_TRANSACTION',
    GET_TRANSACTION = 'GET_TRANSACTION',
    GET_TRANSACTIONS = 'GET_TRANSACTIONS',
    GET_TRANSACTIONS_BY_BLOCK_ID = 'GET_TRANSACTIONS_BY_BLOCK_ID',

    GET_BLOCK = 'GET_BLOCK',
    GET_BLOCKS = 'GET_BLOCKS',

    GET_DELEGATES = 'GET_DELEGATES',
    GET_ACTIVE_DELEGATES = 'GET_ACTIVE_DELEGATES',
    GET_MY_DELEGATES = 'GET_MY_DELEGATES',
}

export const enum EVENT_TYPES {
    APPLY_BLOCK = 'APPLY_BLOCK',
    UNDO_BLOCK = 'UNDO_BLOCK',
    TRANSACTION_DECLINED = 'TRANSACTION_DECLINED',
    TRANSACTION_CONFLICTED = 'TRANSACTION_CONFLICTED'
}