'use strict';

angular.module('sumaAnalysis')
  .controller('ReportCtrl', function ($scope, $http, $location, $anchorScroll, $timeout, initiatives, actsLocs, data, promiseTracker, uiStates, sumaConfig) {
    $scope.initialize = function () {
      // UI State
      $scope.state = uiStates.setUIState('initial');

      // Form data
      _.each(sumaConfig.formData, function (e, i) {
        $scope[i] = e;
      });

      // Form defaults
      $scope.params = {};
      _.each(sumaConfig.formDefaults, function (e, i) {
        $scope.params[i] = $scope[e][0];
      });

      // Date defaults
      $scope.params.sdate = moment().subtract('months', 6).add('days', 1).format('YYYY-MM-DD');
      $scope.params.edate = moment().add('days', 1).format('YYYY-MM-DD');

      // Get inits on load
      $scope.loadInits = initiatives.get().then(function (data) {
        $scope.inits = data;
      }, $scope.error);

      // Setup promise tracker for spinner on initial load
      $scope.finder = promiseTracker('initTracker');
      $scope.finder.addPromise($scope.loadInits);
    };

    // Handle anchor links
    $scope.scrollTo = function (id) {
      var old = $location.hash();
      $location.hash(id);
      $anchorScroll();
      // Reset to old to suppress routing logic
      $location.hash(old);
    };

    // Get Initiative Metadata
    $scope.updateMetadata = function () {
      if ($scope.params.init) {
        $scope.processMetadata = true;
        $scope.actsLocs = actsLocs.get($scope.params.init);

        $scope.activities = $scope.actsLocs.activities;
        $scope.locations = $scope.actsLocs.locations;

        $scope.params.activity = $scope.actsLocs.activities[0];
        $scope.params.location = $scope.actsLocs.locations[0];

        // Artificially add a delay for UI
        $timeout(function () {
          $scope.processMetadata = false;
        }, 400);
      }
    };

    $scope.error = function (data) {
      $scope.state = uiStates.setUIState('error');
      $scope.errorMessage = data.message;
      $scope.errorCode = data.code;
    };

    // Submit Form and Draw Chart
    $scope.submit = function () {
      // UI State
      $scope.state = uiStates.setUIState('loading');

      data[sumaConfig.dataSource]($scope.params, $scope.activities, $scope.locations, sumaConfig.dataProcessor)
        .then(function (processedData) {
          // Bind Data to Scope
          $scope.data = processedData;

          if (sumaConfig.suppWatch) {
            $scope.$watch('data.actsLocsData', function () {
              var index = _.findIndex($scope.data.actsLocsData.items, function (item) {
                return item.title === $scope.data.barChartData.title;
              });

              $scope.data.barChartData = $scope.data.actsLocsData.items[index];
            });
          }

          // UI State
          $scope.state = uiStates.setUIState('success');
        }, $scope.error);
    };

    $scope.initialize();
  });
