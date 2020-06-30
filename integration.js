'use strict';

const request = require('request');
const config = require('./config/config');
const async = require('async');
const fs = require('fs');

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.trace({ entities: entities }, 'doLookup');

  entities.forEach((entity) => {
    //do the lookup
    let requestOptions = {
      uri: `${options.host}/v2/url/decode`,
      method: 'POST',
      body: {
        urls: [entity.value]
      },
      json: true
    };

    tasks.push(function (done) {
      requestWithDefaults(requestOptions, function (error, res, body) {
        if (error || typeof res === 'undefined') {
          Logger.error({ err: error }, 'HTTP Request Failed');
          done({
            detail: 'HTTP Request Failed',
            err: error,
            res: res
          });
          return;
        }

        Logger.trace({ body: body }, 'Result of Lookup');

        if (res.statusCode === 200) {
          // we got data!
          // Validate data form
          if (!Array.isArray(body.urls) || body.urls.length === 0) {
            // Missing urls array so return null
            return done(null, {
              entity,
              body: null
            });
          } else {
            return done(null, {
              entity: entity,
              body: body
            });
          }
        } else if (res.statusCode === 404) {
          // no result found
          return done(null, {
            entity: entity,
            body: null
          });
        } else if (res.statusCode === 400) {
          // bad request
          return done({
            detail:
              'Bad Request. The request is missing a mandatory request parameter, a parameter contains data which is incorrectly formatted, or the API doesnt have enough information to determine the identity of the customer.'
          });
        } else if (res.statusCode === 401) {
          // unauthorized
          return done({
            detail:
              'There is no authorization information included in the request, the authorization information is incorrect, or the user is not authorized'
          });
        } else if (res.statusCode === 429) {
          // too many requests
          return done({
            detail: 'The user has made too many requests over the past 24 hours and has been throttled.'
          });
        } else if (res.statusCode === 500) {
          // internal server error
          return done({
            detail:
              'The service has encountered an unexpected situation and is unable to give a better response to the request'
          });
        } else {
          return done({
            detail: 'Unexpected HTTP Status Received',
            httpStatus: res.statusCode,
            body: body
          });
        }
      });
    });
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      cb(err);
      return;
    }

    results.forEach((result) => {
      if (result.body === null) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: _getTags(result.body),
            details: result.body
          }
        });
      }
    });

    cb(null, lookupResults);
  });
}

// We know we have at least one url in the `urls` array of body
// due to our error handling.
function _getTags(body) {
  const tags = [];
  tags.push(`url: ${body.urls[0].decodedUrl}`);
  if (body.urls.length > 1) {
    tags.push(`+${body.urls.length - 1} more`);
  }
  return tags;
}

function startup(logger) {
  Logger = logger;
  let defaults = {};

  if (typeof config.request.cert === 'string' && config.request.cert.length > 0) {
    defaults.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === 'string' && config.request.key.length > 0) {
    defaults.key = fs.readFileSync(config.request.key);
  }

  if (typeof config.request.passphrase === 'string' && config.request.passphrase.length > 0) {
    defaults.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === 'string' && config.request.ca.length > 0) {
    defaults.ca = fs.readFileSync(config.request.ca);
  }

  if (typeof config.request.proxy === 'string' && config.request.proxy.length > 0) {
    defaults.proxy = config.request.proxy;
  }

  requestWithDefaults = request.defaults(defaults);
}

function validateOptions(userOptions, cb) {
  let errors = [];
  if (
    typeof userOptions.host.value !== 'string' ||
    (typeof userOptions.host.value === 'string' && userOptions.host.value.length === 0)
  ) {
    errors.push({
      key: 'host',
      message: 'You must provide a valid Proofpoint URL Host'
    });
  }

  cb(null, errors);
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  validateOptions: validateOptions
};
