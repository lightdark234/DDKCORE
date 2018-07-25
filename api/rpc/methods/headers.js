const ReservedErrorCodes = require('./../errors');
const {
  METHOD_RESULT_STATUS,
  createServerMethod,
  prepareServerError,
  prepareServerMethodResult,
  hasProperties,
} = require('./../util');



const METHOD_NAME = 'headers';


function Headers (wss, params) {

  let response = {};
  let errorCode = false;
  let errorMessage = 'Error Message';

  if (params.trx) {
    response.title = 'Title Headers';
    response.data = 'Data resend';
  } else {
    errorCode = ReservedErrorCodes.ServerErrorInvalidMethodParameters;
    errorMessage = ReservedErrorCodes[errorCode];
  }






  if (errorCode) {
    return prepareServerMethodResult(METHOD_RESULT_STATUS.ERROR, {},
      prepareServerError(errorCode, errorMessage, response));
  } else {
    return prepareServerMethodResult(METHOD_RESULT_STATUS.SUCCESS, response,
      false);
  }
}

module.exports = createServerMethod(METHOD_NAME, Headers);
