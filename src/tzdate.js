/*

   Copyright 2010 Jan Niehusmann

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.


Design Goals
------------

This library provides a plug-in replacement of the javascript Date class
with the following design goals:

- make it possible to have a js application (running inside
  a web browser) which handles dates in some other timezone than
  browser local time or UTC

- transparently make other libraries (like GUI widget libraries) 
  which do handle dates (eg. for date pickers) use the predefined
  application-specific default time zone

- be accurate (using olson time zone definitions)

- be as compatible to the ecma script date specification as possibe

Usage
-----

To use this library in your code, dependencies must be satisfied:

- include the timezone library (timezoneJS.timezone, available from date.js)
- initialize the timezone library (make zoneinfo files available)
- load this file
- call timezoneJS.overrideDate(defaultTimezone), where defaultTimezone will be
  used for all Date object which don't specifiy another zone

This will change the default Date object following the design goals
mentioned above. It should behave exactly like a 'normal' Date object, just
using a different time zone.

Additionally, when creating Date objects, an individual time zone for that
object can be specified just by adding the time zone name as the last parameter
of the constructor.

Limitations
-----------

ECMAScript specifies that calling Date.parse(x.toString()) returns the same
value as x.valueOf() for any Date object x without a millisecond component.

As the current implementation does not yet implement Date.parse for the format
returned by toString, but instead falls back to the platform provided Date.parse
implementation, this behaviour can't be guaranteed. This should be fixed in a
later revision.

*/

if (typeof timezoneJS == 'undefined') { timezoneJS = {}; }

timezoneJS.overrideDate = (function() { // embed in function literal to create scope for private members
    var oDate = Date; // save the original date type
    var zoneinfoProvider = timezoneJS.timezone; // the zoneinfo provider

    var oPrototype = { // save some prototype functions which we'll override later
        toString: Date.prototype.toString,
        getTimezoneOffset: Date.prototype.getTimezoneOffset
    };

    // Helper functions

    // when time components are changed, invalidate
    // cached information
    var invalidateCaches = function(date) {
        if(date._tz && date._tz.id) {
            date._tz = date._tz.id;
        } else if(typeof date._tz !== 'string') {
            date._tz = undefined;
        }
        date._localDate = undefined;
    }

    // Get a native js object which has the local time representation
    // of this date object in its UTC components.
    //
    // Warning: The returned value is cached, so it must not be modified
    // by the calling function. Therefore, don't return it to the outside.
    var getLocal = function() {
        if(!this._localDate || this._localDateValid !== this.getTime()) {
            this._localDate=new oDate(this.getTime()-this.getTimezoneOffset()*60*1000);
            this._localDateValid = this.getTime();
        }
        return this._localDate;
    };

    // call a set function like setUTCHours on the localDate
    // object and set the time of 'this' accordingly
    var setLocalTimeParts = function(setUTCFunction,args) {
        var localDate = new Date(getLocal.call(this).getTime()); // copy the localDate property
        setUTCFunction.apply(localDate,args); // call the set function on the localDate
        localDate._tz = this._tz.id || this._tz; // copy time zone
        // convert to UTC and set time
        this.setTime(convertFromLocal(localDate).getTime());
        invalidateCaches(this);
    }

    var getZoneInfo = function(date) {
        if(date._tz && date._tz.validAt !== undefined && date._tz.validAt !== date.getTime()) {
            // zone cache is invalid
            date._tz = date._tz.id;
        }
        if(typeof date._tz === 'string') {
            // getZoneInfo calls into zoneinfoProvider, which may call back into
            // the date object. To prevent recursion, the following rules
            // apply:
            // - zoneinfoProvider may only call UTC functions on the date object
            // - UTC functions never call getZoneInfo
            // where 'UTC functions' are all Date methods with UTC in their
            // name, as well as the Date constructor when called with a UTC
            // timestamp. (like in "new Date(Date.UTC(....))")
            var tz = date._tz;
            date._tz = zoneinfoProvider.getTzInfo(date, date._tz, true);
            if(date._tz) {
                date._tz.id = tz;
                date._tz.validAt = date.getTime();
            }
        }
        return date._tz;
    }

    // convert localDate, which contains time information in
    // local time zone in its UTC components, to an equivalent
    // Date with proper UTC time value
    // timezone information comes from localDate._tz, which
    // must be a time zone id (like Europe/London)
    var convertFromLocal = function(localDate) {
        var tzinfo = zoneinfoProvider.getTzInfo(localDate, localDate._tz, false);
        tzinfo.id = localDate._tz;
        tzinfo.validAt = localDate.getTime();
        var utcDate = new oDate(localDate.getTime()+tzinfo.tzOffset*60*1000);
        utcDate._tz = tzinfo;
        return utcDate;
    }

    // Implement ToPrimitive es specified by ECMAScript 3
    var ToPrimitive = function(val) {
        if(typeof val === 'object' && typeof val.valueOf === 'function') {
            var p = val.valueOf();
            if(typeof p !== 'object' && typeof p !== 'function') { // it's primitive - take it!
                val = p;
            } else {
                p = val.toString();
                if(typeof p !== 'object' && typeof p !== 'function') { // it's primitive - take it!
                    val = p;
                } else {
                    throw new TypeError("Cannot find default value for object.");
                }
            }
        }
        return val;
    }

    var overrideDate = function(defaultTimezone) {
        /* replace the Date constructor
         * (when called with 'new', this function will return an instance of oDate,
         * ie. a native javascript date object)
         *
         * Nested definition is necessary, as IE has a bug which causes
         * Date = function Date() {...} to create a local symbol Date instead of
         * redefining the global one. 
         * See http://dmitrysoshnikov.com/ecmascript/chapter-5-functions/#nfe-and-jscript
         * for details.
         */
        var D = (function() { return function Date() {
            var args = Array.prototype.slice.call(arguments);
            var internalDate;
            var tz = defaultTimezone;
            var isLocal = true;
            if(args.length > 1 && typeof args[args.length-1] === 'string') {
                tz = args.pop();
            }
            if(args.length > 1) {
                var year = args[0] || 0;
                var month = args[1] || 0;
                var date = args[2] || 0;
                var hours = args[3] || 0;
                var minutes = args[4] || 0;
                var seconds = args[5] || 0;
                var ms = args[6] || 0;
                internalDate = new oDate(oDate.UTC(year, month, date, hours, minutes, seconds, ms));
            } else if(args.length == 1) {
                // make argument 'primitive'
                var val = ToPrimitive(args[0]);
                if(typeof val === 'string') {
                    var parsedVal = D.parse(val);
                    if(isNaN(parsedVal)) { // not a time string - interpret as timezone instead
                        internalDate = new oDate();
                        isLocal = false;
                        tz = val;
                    } else {
                        internalDate = new oDate(parsedVal); // assume the string contained full TZ info
                        isLocal = false;
                    }
                } else if(typeof val === 'number') {
                    internalDate = new oDate(val);
                    isLocal = false;
                }
            } else {
                internalDate = new oDate(); // current time is current time - doesn't depend on TZ
                isLocal = false;
            }
            internalDate.constructor = D;

            internalDate._tz=tz;
            if(isLocal) { // internalDate still contains local time - apply offset
                internalDate = convertFromLocal(internalDate);
                internalDate.constructor = D;
            }
            
            if ( !(this instanceof arguments.callee) ) {
                  // not called as a constructor -> return string
                  return internalDate.toString();
            }
            return internalDate;
            //return this.toString();
        }})();
	Date = D;

        Date.setDefaultTimezone = function (newDefaultTimezone) {
            defaultTimezone = newDefaultTimezone;
        };

        // make sure that (new Date()) instanceof Date does return true
        Date.prototype = oDate.prototype;

        // and add the properties of the Date constructor
        Date.UTC = oDate.UTC;
        Date.parse = function parse(timestring) {
            // TODO: Implement parsing of the format returned by toString
            if(typeof timestring !== 'string') {
                // ECMAScript 5 defines Date.parse to call
                // ToString(), which also happens when
                // calling the String constructor as a
                // function.
                timestring = String(timestring);
            }
            // try ECMAScript 5 Date Time String Format
            var match = timestring.match('^(?:([+-]?[0-9]{4,})(?:-([0-9]{2})(?:-([0-9]{2}))?)?)?(?:T([0-9]{2})(?::([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]{3}))?)?)?)?(Z|[-+][0-9]{2}:[0-9]{2})?$'); 
            if(match) {
                var parts = {
                    year: match[1] || 0,
                    month:  match[2] || 1,
                    day:  match[3] || 1,
                    hour:  match[4] || 0,
                    minute:  match[5] || 0,
                    second:  match[6] || 0,
                    milli:  match[7] || 0,
                    tz:  match[8] || "Z"
                }
                var utcdate = Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second,parts.milli);
                if(parts.tz !== "Z") {
                    match = parts.tz.match('([-+][0-9]{2})(?::([0-9]{2}))?');
                    if(!match) {
                        return NaN;
                    }
                    var offset = match[1]*60*60*1000+(match[2] || 0)*60*1000;
                    utcdate -= offset;
                }
                return utcdate;
            } else {
                // fall back to original implementation
                // this makes sure that date strings produced by toUTCString() are parsed correctly
                // warning: this doesn't consider defaultTimeZone when given a date without timezone indicator
                return oDate.parse(timestring);
            }
        }

        // replace several protoype functions of the Date object

        Date.prototype.toDateString = function toDateString() {
            var weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][this.getDay()];
            var month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][this.getMonth()];
            var day = this.getDate();
            var year = this.getFullYear();
            return weekday+" "+month+" "+day+" "+year;
        }
        Date.prototype.toTimeString = function toTimeString() {
            // time string without tz information
            var time = ("0"+this.getHours()).slice(-2)+
                       ":"+
                       ("0"+this.getMinutes()).slice(-2)+
                       ":"+
                       ("0"+this.getSeconds()).slice(-2);
            // tz information (like "GMT+0200 (CEST)")
            var tz = "";
            var tzinfo = getZoneInfo(this);
            if(tzinfo) {
                var off=tzinfo.tzOffset;
                var prefix="-";
                if(off<=0) {
                    prefix="+";
                    off= (-off);
                }
                tz = " GMT"+prefix+("0"+Math.floor(off/60)).slice(-2)+("0"+(off%60)).slice(-2)+" ("+tzinfo.tzAbbr+")";
            }
            return time+tz;
        }
        Date.prototype.toString = function toString() {
            if(!this._tz) { // without tz info, fallback to default implementation
                return oPrototype.toString.call(this);
            }
            return this.toDateString()+" "+this.toTimeString();
        }


        Date.prototype.getFullYear = function getFullYear() { return getLocal.call(this).getUTCFullYear(); };
        Date.prototype.getYear = function getYear() { return getLocal.call(this).getUTCYear(); };
        Date.prototype.getMonth = function getMonth() { return getLocal.call(this).getUTCMonth(); };
        Date.prototype.getDate = function getDate() { return getLocal.call(this).getUTCDate(); };
        Date.prototype.getDay = function getDay() { return getLocal.call(this).getUTCDay(); };
        Date.prototype.getHours = function getHours() { return getLocal.call(this).getUTCHours(); };
        Date.prototype.getMinutes = function getMinutes() { return getLocal.call(this).getUTCMinutes(); };
        Date.prototype.getSeconds = function getSeconds() { return getLocal.call(this).getUTCSeconds(); };
        Date.prototype.getMilliseconds = function getMilliseconds() { return getLocal.call(this).getUTCMilliseconds(); };

        Date.prototype.setFullYear = function setFullYear() {
            setLocalTimeParts.call(this,Date.prototype.setUTCFullYear,arguments);
        };
        Date.prototype.setYear = function setYear() {
            setLocalTimeParts.call(this,Date.prototype.setUTCYear,arguments);
        };
        Date.prototype.setMonth = function setMonth() {
            setLocalTimeParts.call(this,Date.prototype.setUTCMonth,arguments);
        };
        Date.prototype.setDate = function setDate() {
            setLocalTimeParts.call(this,Date.prototype.setUTCDate,arguments);
        };
        Date.prototype.setHours = function setHours() {
            setLocalTimeParts.call(this,Date.prototype.setUTCHours,arguments);
        };
        Date.prototype.setMinutes = function setMinutes() {
            setLocalTimeParts.call(this,Date.prototype.setUTCMinutes,arguments);
        };
        Date.prototype.setSeconds = function setSeconds() {
            setLocalTimeParts.call(this,Date.prototype.setUTCSeconds,arguments);
        };
        Date.prototype.setMilliseconds = function setMilliseconds() {
            setLocalTimeParts.call(this,Date.prototype.setUTCMilliseconds,arguments);
        };

        Date.prototype.getTimezoneOffset = function getTimezoneOffset() {
            var tzinfo = getZoneInfo(this);
            if(tzinfo) {
                return tzinfo.tzOffset;
            } else {
                return oPrototype.getTimezoneOffset.call(this); // XXX good fallback?
            }
        }

    }
    return overrideDate;
}());
