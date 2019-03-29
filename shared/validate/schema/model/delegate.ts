import { API_ACTION_TYPES } from 'shared/driver/socket/codes';

export const SCHEMAS_DELEGATES = [
    {
        id: API_ACTION_TYPES.GET_DELEGATES,
        type: 'object',
        properties: {
            limit: {
                type: 'number'
            },
            offset: {
                type: 'number'
            }
        },
        required: ['limit', 'offset']
    },
    {
        id: API_ACTION_TYPES.GET_MY_DELEGATES,
        type: 'object',
        properties: {
            limit: {
                type: 'number'
            },
            offset: {
                type: 'number'
            },
            address: {
                type: 'string'
            }
        },
        required: ['limit', 'offset', 'address']
    }
];