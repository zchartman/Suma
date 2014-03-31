'use strict';

angular.module('sumaAnalysis')
  .filter('countFormat', function () {
    return function (input) {
      var formatCount = d3.format(',');
      return formatCount(input);
    };
  });
