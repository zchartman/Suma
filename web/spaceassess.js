var deviceName = 'iPad';
var appVersion = '0.6.5';

var baseInitUrl = "/sumaserver/clientinit/";
var initiativeUrl = "/sumaserver/clientinit/load/initiative/";
var syncUrl = "/sumaserver/sync";

var startDialogVisible = true;
var currentlySyncing = 0;

var sessionStart;
var currentSession;
var sessionInit = null;
var currentSessionArr = [];
var currentActivities = null;
var currentlyCollecting = false;
var currentLoc = null;
var currentLocCount = null;

var buttonEventType = 'click';
var initSelectObj = null;
var countForm = null;
var countIndicator = null;
var submitTouchState = [];

// This has been converted from a function that serializes all data and once and syncs it to 
// one that just syncs one session at a time. This is a performance optimization.
// There is still some cruft in here from the old way.
// It is still pretty slow. Ideally, using transactions could speed it up,
// but seems to actually slow it down on the iPad. It may be because of
// write-locking, which would interfere with the destroyAll() calls after the ajax
// submission.
function serializeCollectedData(callback) {
    if (currentlySyncing > 0) {
        return;
    }

    persistence.flush(function() {
        Session.all().filter('stopTime', '!=', null).prefetch("initiative").each(function(session) {
            currentlySyncing++;
            var serializedSessions = [];

            var countJson = {device:deviceName, version:appVersion}
            countJson['sessions'] = new Array(1);
            serializedSessions[0] = session.id;
            var currSessionIndex = 0;
            var sessInitId = 'orphan';
            if (session.initiative !== null) {
                sessInitId = session.initiative.serverId;
            }

            countJson['sessions'][currSessionIndex] = {initiativeID: sessInitId, startTime: Math.round(session.startTime/1000), endTime: Math.round(session.stopTime/1000), counts:[]};

            session.people.prefetch("location").order('timestamp', true).list(function(counts) {
                var completionCounter = counts.length * 2;
                if (completionCounter === 0) {
                    callback(countJson, serializedSessions);
                    return;
                }

                $.each(counts, function(peopleKey, count) {
                    // Reference counts.length and sessions.length
                    var currCountIndex = peopleKey;
                    countJson['sessions'][currSessionIndex]["counts"][currCountIndex] = {timestamp: Math.round(count.timestamp/1000), number:count.count, location: count.location.serverId, activities: []};
                    count.activities.list(function(activities) {
                        $.each(activities, function(actKey, activity) {
                            countJson['sessions'][currSessionIndex]["counts"][currCountIndex]["activities"][actKey] = activity.serverId;
                        });
                        completionCounter--;
                        if (completionCounter === 0) {
                            callback(countJson, serializedSessions);
                            return;
                        }
                    });
                    completionCounter--;

                    if (completionCounter === 0) {
                        callback(countJson, serializedSessions);
                        return;
                    }
                });
            });
        });
    });
}

function clearPlaceholderCounts (callback) {

    // setTimeout uses for callbacks in some parts of the code
    // in an attempt to avoice the "Javascript execution exceeded timeout
    // error on mobile devices
    Session.all().list(function(sessions) {
        var sessionsCounter = sessions.length;
        if (sessionsCounter === 0) {
            setTimeout(function(){callback();}, 0);
        }

        $.each(sessions, function(key, session) {
            session.people.filter('count', '=', 0).prefetch('location').list(function(counts) {
                var numCounts = counts.length;
                if (numCounts === 0) {
                    sessionsCounter--;
                    if (sessionsCounter === 0) {
                        setTimeout(function(){callback();}, 0);
                    }
                }

                $.each(counts, function(key, count) {
                    count.location.people.filter('session', '=', session).count(function(numLocSessCounts) {
                        if (numLocSessCounts > 1) {
                            persistence.remove(count);
                        }
                        numCounts--;
                        if (numCounts === 0) {
                            sessionsCounter--;
                            if (sessionsCounter === 0) {
                                setTimeout(function(){callback();}, 0);
                            }
                        }
                    });
                });
            });
        });
    });
}

function checkCompletion(compCounter) {
    var completeCount = true;
    $.each(compCounter, function(key, val) {
        if (val !== 0) {
            completeCount = false;
            return false;
        }
    });
    return completeCount;
}

function showStartDialog() {
    initSelectObj.val("");
    startDialogVisible = true;
    currentSessionArr = [];
    $("#spaceAssessDialog").dialog("open");
}

function updateHeights() {
    var sidebar_height = $("div.sidebar").height();
    var mainentry_height = $("div.main_entry").height();
    var initheader_height = $("div.initiatives_content").height();
    var mainheader_height = $("div.header_content").height();

    if (initheader_height >= mainheader_height) {
        $("div.header_content").css("min-height",initheader_height);
    } else {
        $("div.initiatives_content").css("min-height",mainheader_height);
    }
}

function updateInitiatives() {
    persistence.transaction(function(dbTransaction) {
        Initiative.all().count(dbTransaction, function(initCount) {
            $("option.initOpt", initSelectObj).remove();
            if (initCount === 0) {
                $.ajax({url: baseInitUrl, dataType: "json", async: false}).success(function(initData) {
                    $.each(initData, function(key,init) {
                        var newInit = new Initiative({serverId: init['initiativeId'], name: init['initiativeTitle']});
                        persistence.add(newInit);
                        initSelectObj.append('<option class="initOpt" value="' + newInit.id + '">' + newInit.name + '</option>');
                    });
                    persistence.flush(dbTransaction);
                });
            } else {
                Initiative.all().each(dbTransaction, function(init) {
                    initSelectObj.append('<option class="initOpt" value="' + init.id + '">' + init.name + '</option>');
                });
            }

        });
    });
}

function removeActivities() {
    $(".activityContainer").empty();
    currentActivities = {};
}

function displayActivities(actInit, callback) {
    removeActivities();
    var countForm = $("form#count_form");
    var leftActivity = $("#leftActivities", countForm);
    var rightActivity = $("#rightActivities", countForm);
    var currentColumn = leftActivity;

    currentActivities = {};

    actInit.activities.list(function(activities) {
        $.each(activities, function(key, activity) {

            currentActivities[activity.id] = activity;

            // Hack to support grouped activity hacks
            var actClass = "actA";

            var buttonStr = '<input type="checkbox" value="' + activity["id"] + '" id="check' + activity["serverId"] + '" class="check jqButton" /><label for="check' + activity["serverId"] + '" class="' + actClass + '">' + activity["name"] + '</label><br />';

            currentColumn.append(buttonStr);

            if (currentColumn === leftActivity) {
                currentColumn = rightActivity;
            } else {
                currentColumn = leftActivity;
            }


            $("input.check", countForm).button();
        });
        callback();
    });
}

function removeLocs() {
    $("ul.loc_list:first").empty().siblings().remove();
    $("#current_loc_label").text("No current location");

}

function displayLocs(parent, callback) {
    removeLocs();
    var topLocSelector = $("ul.loc_list:first");
    topLocSelector.append('<h2>' + parent.name + '</h2>');
    parent.children.list(function(locs) {
        $.each(locs, function(key, loc) {
            topLocSelector.append('<li class="loc_item"><a id="loc' + loc.id + '" href="' + loc.id + '">' + loc.name + '    <span class="locCount"></span></a></li>');
            annotateLoc(loc);
        });
        callback();
    });
}

function annotateLoc(locObj) {
    if (currentlyCollecting) {
        locObj.people.filter('session', '=', currentSession).count(function(pCount) {
            if (pCount > 0) {
                pCount--;
                $('a#loc' + locObj.id).find('span.locCount').text('(' + (pCount) + ')');
            }
        });
    }
}

function fetchLocsActivities(init, callback)
{
    var locUrl = initiativeUrl + init['serverId'];
    var parentLoc;
    persistence.transaction(function(dbTransaction) {
        init.activities.list(dbTransaction, function(activs) {

            $.each(activs, function(activ) {
                persistence.remove(activ);
            });

            $.ajax({url: locUrl, dataType: 'json', async:false}).success(function(locData){
                var locTree = locData["locations"];
                parentLoc = new Location({name:locTree["title"], serverId:locTree["id"]});
                persistence.add(parentLoc);
                init.location = parentLoc;
                if ("children" in locTree) {
                    parseLocs(locTree["children"], parentLoc);
                }

                $.each(locData["activities"], function(key, activity) {
                    var newAct = new Activity({name:activity["title"],serverId:activity["id"]});
                    newAct.initiative = init;
                    persistence.add(newAct);
                });
                persistence.flush(dbTransaction, function() {
                    callback();
                });
            }).error(function() {
                alert("Error fetching locations. Please reload and try again");
            });
        });
    });
}

function parseLocs(locArray, parent) {
    $.each(locArray, function(key, val) {
        var newLocObj = new Location({name:val['title'], serverId:val['id']});
        newLocObj.parent = parent;
        persistence.add(newLocObj);

        if ("children" in val) {
            parseLocs(val['children'], newLocObj);
        }
    });
}

function stopCollecting(sync){

    var date = new Date();

    if (currentlyCollecting){
        currentSession["stopTime"] = date.getTime();
        currentlyCollecting = false;
        persistence.flush(function() {
            if (true === sync) {
                closeOldSessions(function() {
                    clearPlaceholderCounts(syncSessions);
                });
            }
        });
            //$("#session_timer").text('00h:00m:00s');
        sessionStart = null;
        currentSession = null;
        countIndicator.val('Count');

    } else {
        if (true === sync) {
            closeOldSessions(function() {
                clearPlaceholderCounts(syncSessions);
            });
        }
    }

    removeLocs();
    removeActivities();

}

function closeOldSessions(callback) {
    var date = new Date();
    // Close off any old sessions
    Session.all().filter('stopTime', '=', null).list(function(sessions) {
        var numSessions = sessions.length;
        if (numSessions === 0) {
            callback();
        }

        $.each(sessions, function(key, session) {
            session.stopTime = date.getTime();
            numSessions--;
            if (numSessions === 0) {
                persistence.flush(function() {
                    callback();
                });
            }
        });
    });
}

function syncSessions() {
    // This is a little confusing. currentlySyncing gets incremented in serializeCollectedData
    // but decremented here. This could be better for sure.
    if (0 === currentlySyncing) {
        serializeCollectedData(function(serJson, sessionIDs) {
            var syncStart = (new Date).getTime();
            $.ajax({
                url: syncUrl,
                type: 'POST',
                data: {json:JSON.stringify(serJson)},
            }).success(function() {
                var syncStop = (new Date).getTime();
                console.log((syncStop - syncStart) + " milliseconds to server");
                $.each(sessionIDs, function(key, sessionID) {
                    Session.load(sessionID, function(session) {
                        if (null !== session) {
                            persistence.remove(session);
                            session.people.destroyAll(function() {
                                persistence.flush(function() {
                                    currentlySyncing--;
                                    alert("data sent to server");
                                });
                            });
                        }
                    });
                });
            }).error(function(xhr, ajaxOptions, thrownError) {
                currentlySyncing--;
                alert("Error sending data to server, please contact an administrator: " + thrownError);
            }); 
        });
    }
}

function readyToCollect() {
    if ((currentLoc) && (initSelectObj.val() != '')) {
        return true;
    } else {
        $("div.sidebar").stop(true,true).effect("pulsate", {times:3}, 500);
        return false;
    }
}

function abandonCollection() {
    $("#loadingScreen").dialog('open');
    $.each(currentSessionArr, function(key,session) {
        persistence.remove(session);
        session.people.destroyAll();
    });
    currentSessionArr = [];
    stopCollecting(false);

    setTimeout(function() {
        $("#loadingScreen").dialog('close');
        showStartDialog();
    }, 1500);
}

function hitAbandonButton() {
    $("#abandonContent").dialog("open");
}

function startCollecting(){
    if (!currentlyCollecting) {
        if (!readyToCollect()) {
            return false;
        }

        if (sessionInit === null) {
            alert("There is an error; please reload this page");
        }

        currentlyCollecting = true;

        var date = new Date();
        sessionStart = date.getTime();
        currentSession = new Session({startTime: sessionStart});
        currentSessionArr.push(currentSession);
        currentSession.initiative = sessionInit;
        persistence.add(currentSession);
        persistence.flush();
    }
    return true;
}

function updateTimer() {
    if (currentlyCollecting) {
        var date = new Date();
        var timeDiff = (date.getTime() - sessionStart) / 1000;
        var hours = Math.floor(timeDiff/3600) + 'h';
        if (hours.length === 2) {
            hours = '0' + hours;
        }
        var minutes = Math.floor((timeDiff / 3600) / 60) + 'm';
        if (minutes.length === 2) {
            minutes = '0' + minutes;
        }
        var seconds = Math.floor((timeDiff / 3600) / 60) + 's';
        if (seconds.length === 2) {
            seconds = '0' + seconds;
        }

        var timeString = hours + ':' + minutes + ':' + seconds;
        $("#session_timer").text(timeString);
        setTimeout(function(){updateTimer();}, 1000);
    }
}

function undoCount() {

    if (readyToCollect() && startCollecting()) {
        persistence.transaction(function(dbTransaction) {
            var currentPeople = Person.all().filter('session', '=', currentSession).filter('location', '=', currentLoc).order('timestamp', false);
            var lastTimestamp = null;
            currentPeople.one(dbTransaction, function(person){
                if (person.count > 0) {
                    countIndicator.val(parseInt(countIndicator.val()) - person.count);
                    currentLocCount.text('(' + countIndicator.val() + ')');
                } else {
                    countIndicator.val("Count");
                    currentLocCount.text("");
                }
                persistence.remove(person);
                persistence.flush(dbTransaction);
            });
        });
    }
    return;
}

function countPeople(doubleTap) {
    var date = new Date();

    if (!(readyToCollect() && startCollecting())) {
        return false;
    }

    // If we want to re-enable non-incremental counts
    //countInput = $("input#count_input");
    //var newCount = parseInt(countInput.val());
    var newCount = 1;
    if (!isNaN(newCount)) {

        if ((newCount === 1) && doubleTap) {
            newCount++;
        }

        var countObj = new Person({timestamp:date.getTime()});
        $("input.check:checked", countForm).each(function() {
            countObj.activities.add(currentActivities[$(this).val()]);
        }).removeAttr("checked").button("refresh");
        countObj.location = currentLoc;
        countObj.session = currentSession;
        countObj.count = newCount;
        persistence.add(countObj);

        if (!parseInt(countIndicator.val())) {
            countIndicator.val(newCount);
        } else {
            countIndicator.val(parseInt(countIndicator.val()) + newCount);
        }
        currentLocCount.text('(' + countIndicator.val() + ')');
        persistence.flush();
    } else {
        alert("error--Not a Number");
        return false;
    }
}

function initAfterDB() {

    initSelectObj.val("");
    updateInitiatives();
    stopCollecting(true);

    $(window).unload(function(){
        // If they leave the page or reload, complete the session
        stopCollecting(false);
    });
}

$(function() {
    initSelectObj = $("select#init_selector");
    countForm = $("form#count_form");
    countIndicator = $("input#goesup", countForm);
    // TODO: check for error
    initSADB(initAfterDB);

    $("#spaceAssessDialog").dialog({
        bgiframe: true,
        title: "Space Usage Census Tool",
        autoOpen: false,
        height: 325,
        width: 350,
        modal: true,
        closeOnEscape: false,
        resizable: false,
        draggable: false,
        open: function() {
            $(".ui-dialog").css({overflow: 'visible'});
        },
        buttons: { 'Start Collecting': function() {
            startDialogVisible = false;
            $(this).dialog("close");
        }}
    });

    showStartDialog();
    // create the loading window and set autoOpen to false
    $("#loadingScreen").dialog({
        autoOpen: false,
        //dialogClass: "loadingScreenWindow",
        title: "Processing...",
        closeOnEscape: false,
        draggable: false,
        width: 200,
        minHeight: 90,
        modal: true,
        buttons: {},
        resizable: false,
    });

    $("#abandonContent").dialog({
        autoOpen: false,
        title: "Abandon Session",
        closeOnEscape: false,
        draggable: false,
        width: 350,
        minHeight: 300,
        modal: true,
        open: function() {
            $(".ui-dialog").css({overflow: 'visible'});
        },
        buttons: {'DELETE': function() {
                    $(this).dialog("close");
                    abandonCollection();
                },
                'Keep Collecting': function() {
                    $(this).dialog("close");
                }},
        resizable: false
    });

    $(".jqButton").button();
    updateHeights();


    var agent = navigator.userAgent.toLowerCase();

    if(agent.indexOf('iphone') >= 0 || agent.indexOf('ipad') >= 0 || agent.indexOf('android') >= 0){
        buttonEventType = 'tap';

        $('.tappable').bind('touchstart', function(event) {
            var e = event.originalEvent;
            submitTouchState.numTouches = e.touches.length;
            submitTouchState.startTime  = (new Date).getTime();
            submitTouchState.startX = e.changedTouches[0].clientX;
            submitTouchState.startY = e.changedTouches[0].clientY;
            return false;
        });


        $('.tappable').bind('touchend', function(event) {
            var timeDelta = (new Date).getTime() - submitTouchState.startTime;
            var e = event.originalEvent;
            var deltaX = Math.abs(submitTouchState.startX - e.changedTouches[0].clientX);
            var deltaY = Math.abs(submitTouchState.startX - e.changedTouches[0].clientX);
            if ((submitTouchState === []) || ((submitTouchState.numTouches === 1) && (timeDelta <= 500) && (deltaX < 50) && (deltaY < 50))) {
                $(this).trigger('tap');
            } 

            submitTouchState = [];
            return false;
        });
    }


    $("div#loc_lists").delegate("li.loc_item a", "click", function() {
        currentLoc = null;
        currentLocCount = null;
        $("#loadingScreen").dialog('open');
        var currentList = $(this).parent().parent();
        clickEl = this;
        currentList.nextAll().remove();
        updateHeights();
        $(this).parent().siblings("li").removeClass("selected_loc");
        $("li.deepest_loc").removeClass("deepest_loc");
        $(this).parent().addClass("selected_loc deepest_loc");
        persistence.transaction(function(dbTransaction) {
            Location.load(dbTransaction, $(clickEl).attr("href"), function(loc){

                // Build a string showing the chain of selected locations
                var parentLoc = loc;
                // Arbitrary max depth of 20
                var i = 0;
                var combinedLocTitle = '';
                while ((parentLoc != null) || i > 20) {
                    if ('' !== combinedLocTitle) {
                        combinedLocTitle = parentLoc.name + ' | ' + combinedLocTitle;
                    } else {
                        combinedLocTitle = parentLoc.name;
                    }
                    parentLoc = parentLoc.parent;
                    i++; 
                }

                $("#current_loc_label").text(combinedLocTitle);

                loc.children.list(dbTransaction,function(locKids) {
                    if (locKids.length > 0) {
                        $(currentList).after('<ul class="loc_list"></ul>');
                        // Insert the new child locations
                        var childSel = $("ul.loc_list:last");
                        $.each(locKids, function(key, loc){
                            childSel.append('<li class="loc_item"><a id="loc' + loc.id + '" href="' + loc.id + '">' + loc.name + '    <span class="locCount"></span></a></li>');
                            annotateLoc(loc);
                        });
                        updateHeights();
                        countIndicator.val('Count');
                        $("#loadingScreen").dialog('close');
                    } else {
                        // test for terminal locs--only allow collection if there are no children
                        currentLoc = loc;
                        currentLocCount = $(clickEl).find('span.locCount');

                        // Start a new session as soon as a location is selected
                        startCollecting();

                        // TODO: Handle count rows that represent more than 1 person
                        Person.all().filter('session', '=', currentSession).filter('location', '=', currentLoc).count(dbTransaction, function(numCounts) {
                            if (numCounts > 0) {
                                // right now, this subtracts the "zero" placeholder count
                                countIndicator.val(numCounts-1);
                                currentLocCount.text('(' + (numCounts-1) + ')');
                            } else {
                                // Placeholder so that we know that this location has been visited
                                countIndicator.val('Count');
                                var countObj = new Person({timestamp:(new Date).getTime()});
                                countObj.location = currentLoc;
                                countObj.session = currentSession;
                                countObj.count = 0;
                                persistence.add(countObj);
                                currentLocCount.text('(0)');
                            }
                            persistence.flush(dbTransaction, function() {
                                $("#loadingScreen").dialog('close');
                            });
                        });
                    }
                });
            });
        });
        return false;
    });

    $("form#init_form").delegate('select#init_selector', 'change', function() {

        $("#loadingScreen").dialog('open');
        stopCollecting(false);

        persistence.transaction(function(dbTransaction) {
            Initiative.findBy(dbTransaction, 'id', initSelectObj.val(), function(init){
                sessionInit = init;

                if (sessionInit !== null) {
                    persistence.flush(dbTransaction, function() {
                        sessionInit.fetch('location', function(){
                            if (sessionInit.location === null) {
                                fetchLocsActivities(sessionInit, function() {
                                    sessionInit.fetch('location', function(){
                                        displayLocs(sessionInit.location, function() {
                                            displayActivities(sessionInit, function() {
                                                $("#loadingScreen").dialog('close');
                                            });
                                        });
                                    });
                                });
                            } else {
                                displayLocs(sessionInit.location, function() {
                                    displayActivities(sessionInit, function() {
                                        $("#loadingScreen").dialog('close');
                                    });
                                });
                            }
                        });
                    });
                } else {
                    $("#loadingScreen").dialog('close');
                    showStartDialog();
                    stopCollecting(true);
                }
            });
        });
        return false;
    });

    $("body").delegate("a#abandon_session", "click", function(){
        hitAbandonButton();
    });

    $("body").delegate("a#save_session", "click", function(){
        initSelectObj.val("");
        showStartDialog();
        stopCollecting(true);
        currentSessionArr = [];
        //displaySessions();
        return false;
    });

    $("input#goesup").bind(buttonEventType, function() {
        countPeople(false);
        return false;
    });

    $("a#goesdown").bind(buttonEventType, function() {
        undoCount();
        return false;
    });

    $("a").live("click", function() {
        return false;
    });

    $("form").live("submit", function() {
        return false;
    });
});