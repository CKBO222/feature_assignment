/* Any functions to help process and return our data consistently */

const { set } = require("express/lib/application");
let fs = require("fs")

function getSplitAmount(splitFactorContents){
    let splitAmount = [];
    for(let i = 0; i < splitFactorContents.length; i++){
        if(splitFactorContents[i].rate == null){
            splitAmount.push(0);
        }
        else{
            splitAmount.push(splitFactorContents[i].rate);
        }
    }
    return splitAmount;
}

//The split factor column
function getSplitFactor(splitFactorContents, splitAmount){
    let splitFactor = [1];
    for(let i = 1; i < splitFactorContents.length; i++){
        if(splitAmount[i] > 0){
            splitFactor.push(splitAmount[i] * splitFactor[i-1]);
        }
        else{
            splitFactor.push(splitFactor[i-1]);
        }
    }
    return splitFactor;
}

//This function will calculate the difference in days between two dates
function getCalendarDays(datesBidAskContents){
    let calendarDays = [0];
    for(let i = 1; i < datesBidAskContents.length; i++){
        let milliseconds = new Date(datesBidAskContents[i].date_) - new Date(datesBidAskContents[i - 1].date_);
        let seconds = milliseconds / 1000;
        let minutes = seconds / 60;
        let day = minutes / 1440;
        calendarDays.push(Math.round(day));
    }
    return calendarDays;
}

//Get initial investment
function getInitialInvestment(dataContents){
    return dataContents[0].nonAdjustedClose * 100;
}

//The option purchase price column
function getOptionPurchasePrice(datesBidAskContents, exDates){
    let purchasePrice = new Map();
    for(let i = 0; i < datesBidAskContents.length; i++){
        if(exDates.has(new Date(datesBidAskContents[i].date_).toDateString())){
            purchasePrice.set(new Date(datesBidAskContents[i].date_).toDateString(), parseFloat(datesBidAskContents[i].ask));
        }
    }
    return purchasePrice;
}

//Assums the options to buy is always set at 1.
function getOptionInvestmentAtEndOfDay(datesBidAskContents, exDates){
    let purchasePrice = getOptionPurchasePrice(datesBidAskContents, exDates);
    let optionInvestments = new Map();

    for(const key of purchasePrice.keys()){
        optionInvestments.set(key, purchasePrice.get(key) * 100);
    }
    return optionInvestments;
}

//This part will have the options to buy always set at 1.  Changed later
function getOpenOptionValueAtEndOfDay(datesBidAskContents, splitFactor){
    let optionValsAtEndOfDay = [];
    for(let i = 0; i < datesBidAskContents.length; i++){
        optionValsAtEndOfDay.push(parseFloat(datesBidAskContents[i].bid) * splitFactor[i]* 100);
    }
    return optionValsAtEndOfDay;

}

//The prior month terminal value column
function getPriorMonthTerminalValue(end, strike, splitAdj, equal){
    if(equal){
        if(0 > (end - strike)){
            return 0;
        }
        return (end - strike);
    }

    //If the split and prior split are NOT equal
    if(0 > (splitAdj - strike)){
        return 0;
    }
    return (splitAdj - strike);
}

function getCashAtBeginningOfDay(liborContents, dataContents, datesBidAskContents, exDates, strikeContents, splitFactor, calendarDays){
    let cashAtBeginOfDay = [getInitialInvestment(dataContents)];
    let proceedsFromExpiringOption = [];
    let interestArr = [];
    let csvProceedsFromExpiringOption = [];
    let optionInvestments = getOptionInvestmentAtEndOfDay(datesBidAskContents, exDates)
    let libor = undefined;
    let splitValOnExpDate = 1;
    let priorMonthSplitValue = undefined;
    let priorMonthSplitArr = [];
    let equal = true;
    let strikeIndex = 0;

    //Edge case, need to append 0 to proceedsFromExpiringOption if the timeframe starts on exp date, and priorMonthsplit value gets a 1. 
    //NOT SURE IF PRIOR MONTH SPLIT VALUE AT START OF SEARCH PERIOD CAN ALWAYS BE ASSUMED TO BE A 1.
    if(exDates.has(new Date(datesBidAskContents[0].date_).toDateString())){
        proceedsFromExpiringOption.push(0);
        priorMonthSplitArr.push(1);
        csvProceedsFromExpiringOption.push(0);
    }

    for(let i = 1; i < dataContents.length+1; i++){
        libor = parseFloat(liborContents[i-1].value_) * 100;
        let interest = libor / 100.0000 / 365.0000 * parseFloat(cashAtBeginOfDay[i-1]) * calendarDays[i-1];
        interestArr.push(interest);
        let sum = parseFloat(cashAtBeginOfDay[i-1]) + interest;
        let day = new Date(datesBidAskContents[i-1].date_).toDateString();
        let terminalValue = undefined;  

        //THIS PART NEEDS TO HAVE THE "PROCEEDS FROM EXPIRING OPTION" SUMMED INTO IT AS WELL AFTER WE FIGURE OUT THE SPLIT FACTOR
        if(optionInvestments.has(day)){
            let optInvest = optionInvestments.get(day) * splitFactor[i-1];
            sum -= parseFloat(optInvest);
            
            if(exDates.has(day)){

                //Need i > 1 because we don't want this to run if the first day of the date range is an exp date
                if(i > 1){
                    let close = dataContents[i-1].nonAdjustedClose;
                    let strike = strikeContents[strikeIndex].strike;

                    //These two lines handle the prior month split factor column of the spreadsheet.
                    priorMonthSplitValue = splitValOnExpDate;
                    priorMonthSplitArr.push(priorMonthSplitValue);
                    splitValOnExpDate = splitFactor[i-1];

                    //Get the split adj val in case its needed for the terminalValue
                    let splitAdjVal = 0;

                    //This handles whether the split is equal to the prior month's
                    //Need the equal variable because even after the split factors are not equal, they need to run the split * close calculation one more time.
                    //When close is finally set to false, it closes off that calculation for good.
                    if(!equal || splitValOnExpDate != priorMonthSplitValue){
                        if(equal){
                            splitAdjVal = splitFactor[i-1] * dataContents[i-1].nonAdjustedClose;
                        }
                        else{
                            splitAdjVal = dataContents[i-1].nonAdjustedClose;
                        }
                        if(priorMonthSplitValue != undefined){
                            equal = false;
                        }
                        terminalValue = getPriorMonthTerminalValue(close, strike, splitAdjVal, false);
                    }
                    else {
                        splitAdjVal = splitFactor[i-1] * dataContents[i-1].nonAdjustedClose;
                        terminalValue = getPriorMonthTerminalValue(close, strike, splitAdjVal, true);
                    }
                    
                    //This block handles the "proceeds from expiring option" for the cash at beginning of day
                    //These proceeds have to be processed for both the cashatEndOfDay and cashAtBeginOfDay arrays
                    sum += (terminalValue * 100 * priorMonthSplitValue);
                    proceedsFromExpiringOption.push(terminalValue * 100 * priorMonthSplitValue);
                    csvProceedsFromExpiringOption.push(terminalValue * 100 * priorMonthSplitValue);
           
                    strikeIndex += 1;
                }
            }
        }
        else{
            csvProceedsFromExpiringOption.push(0);
        }
        cashAtBeginOfDay.push(sum);
    }

    return {cashAtBeginOfDay, optionInvestments, proceedsFromExpiringOption, interestArr, csvProceedsFromExpiringOption, priorMonthSplitArr};
}

function getAccountValueAtEndOfDay(cashAtEndOfDay, openOptionVal){
    let accountVal = [];
    for(let i = 0; i < cashAtEndOfDay.length; i++){
        accountVal.push(cashAtEndOfDay[i] + openOptionVal[i]);
    }
    return accountVal;
}

//The get cash cash at the end of the day spreadsheet column
function getCashAtEndOfDay(cashAtBeginOfDay, proceedsFromExpiringOption, optionInvestment, datesBidAskContents, splitFactor, priorMonthSplitArr){
    let day = undefined;
    let cashAtEndOfDay = [];
    let it = 0;

    for(let i = 0; i < datesBidAskContents.length; i++){
        day = new Date(datesBidAskContents[i].date_).toDateString();
        if(!optionInvestment.has(day)){
            cashAtEndOfDay.push(cashAtBeginOfDay[i]);
        }
        else{
      //      cashAtEndOfDay.push(cashAtBeginOfDay[i] - (optionInvestment.get(day) * splitFactor[i]) + (proceedsFromExpiringOption[it] * priorMonthSplitArr[it]));
            cashAtEndOfDay.push(cashAtBeginOfDay[i] - (optionInvestment.get(day) * splitFactor[i]) + (proceedsFromExpiringOption[it]));
            it += 1;
        }
    }
    return cashAtEndOfDay;
}

//This will create one of the indexes that needs to be graphed.
function getOptionBuyingIndex(accountValEndOfDay){
    let optionBuyingIndex = [100.00];
    const initValue = accountValEndOfDay[0];
    for(let i = 1; i < accountValEndOfDay.length; i++){
        let newVal = (accountValEndOfDay[i] / initValue) * 100;
        optionBuyingIndex.push(newVal.toFixed(2));
    }

    return optionBuyingIndex;
}

//This will create one of the indexes that needs to be graphed
function getTotalReturnIndex(dataContents){
    let totalReturn = [100.00];
    const initVal = dataContents[0].totalReturn;

    for(let i = 1; i < dataContents.length; i++){
        let retVal = (dataContents[i].totalReturn / initVal) * 100;
        totalReturn.push(retVal.toFixed(2));
    }
    return totalReturn;
}

//Return the indexes and dates as required by the front end
function returnSetUp(datesBidAskContents, optionBuyingIndex, totalReturnIndex) {
    let dateArray = [];
    for(let i = 0; i < datesBidAskContents.length; i++){
        dateArray.push(datesBidAskContents[i].date_);
    }

    let optionIndex = [];
    for(let i = 0; i < optionBuyingIndex.length; i++){
        optionIndex.push(parseFloat(optionBuyingIndex[i]));
    }

    let totReturnIndex = []
    for(let i = 0; i < totalReturnIndex.length; i++){
        totReturnIndex.push(parseFloat(totalReturnIndex[i]));
    }
    return [dateArray, optionIndex, totReturnIndex];
}

//This is the conglomerate function which will be the pipeline of the data processing
function dataReception(splitFactorContents, strikeContents, datesBidAskContents, dataContents, liborContents, exDates){

    //These return values all correspond to a column from the spreadsheet
    let splitAmount = getSplitAmount(splitFactorContents);
    let splitFactor = getSplitFactor(splitFactorContents, splitAmount);
    let calendarDays = getCalendarDays(datesBidAskContents);
    let cashAtBeginOfDayReturn = getCashAtBeginningOfDay(liborContents, dataContents, datesBidAskContents, exDates, strikeContents, splitFactor, calendarDays);
    let cashAtBeginOfDay = cashAtBeginOfDayReturn.cashAtBeginOfDay;
    let optionInvestments = cashAtBeginOfDayReturn.optionInvestments;
    let proceedsFromExpiringOption = cashAtBeginOfDayReturn.proceedsFromExpiringOption;
    let priorMonthSplitArr = cashAtBeginOfDayReturn.priorMonthSplitArr;
    let interestArr = cashAtBeginOfDayReturn.interestArr;
    let proceedsFromExpiringOptionCSV = cashAtBeginOfDayReturn.csvProceedsFromExpiringOption;
    let openOptionVal = getOpenOptionValueAtEndOfDay(datesBidAskContents, splitFactor);
    let cashAtEndOfDay = getCashAtEndOfDay(cashAtBeginOfDay, proceedsFromExpiringOption, optionInvestments, datesBidAskContents, splitFactor, priorMonthSplitArr);
    let accountValEndOfDay = getAccountValueAtEndOfDay(cashAtEndOfDay, openOptionVal);
    let optionBuyingIndex = getOptionBuyingIndex(accountValEndOfDay);
    let totalReturnIndex = getTotalReturnIndex(dataContents);

    const content = 'Date, Option ID, Strike, Close, Total Return, Split Amount, Split Factor, Calendar Days, Bid, Ask, Libor, Cash at Beginning of Day, Proceeds From Expiring Option, Interest, Open Option Value, Cash At End of Day, Account Val at End of Day, Option Buying Index, Total Return Index' + "\n";

    // -----------------------------This is the beginning of the .CSV contents------------------------------------------------------
    
    fs.writeFile('files/spreadsheet.csv', content, err => {
    if (err) {
        console.error(err)
        return
    }
    })

    let csvContent = "";
    let it = 0;
    let flag = false;

    for(let i = 0; i < datesBidAskContents.length; i++){
        if(exDates.has(new Date(datesBidAskContents[i].date_).toDateString())){
            if(flag){
                it += 1;
            }
            else{
                flag = true;
            }
        }
        csvContent += new Date(datesBidAskContents[i].date_).toDateString() + "," +  strikeContents[it].optid + "," + strikeContents[it].strike + "," + dataContents[i].nonAdjustedClose + "," + dataContents[i].totalReturn + "," + splitAmount[i] + "," + splitFactor[i] + "," + calendarDays[i] + "," + datesBidAskContents[i].bid + "," + datesBidAskContents[i].ask + "," + liborContents[i].value_ + "," + cashAtBeginOfDay[i] + "," + proceedsFromExpiringOptionCSV[i] + "," + interestArr[i] + "," + openOptionVal[i] + "," + cashAtEndOfDay[i] + "," + accountValEndOfDay[i] + "," + optionBuyingIndex[i] + "," + totalReturnIndex[i] + "\n";
    }

    fs.appendFile('files/spreadsheet.csv', csvContent, err => {
        if (err) {
            console.error(err)
            return
        }
    })

    //-------------------------------This is the end of the .CSV contents----------------------------------------------------------------------------

   return returnSetUp(datesBidAskContents, optionBuyingIndex, totalReturnIndex);
}
module.exports = {dataReception};
