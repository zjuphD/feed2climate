
library(tseries)
library(dlm)

###### Select individual to analyze (from 1 to 100) #######
 ID_NUMB <- "90" #Indicate individual number 

###### DATA PREPARATION ###############
#Data import
 raw_data <- read.csv("C:/Users/glenoir/Documents/THESE/Article/Article 2/DataAxiom.CSV",header=TRUE,sep=",",dec=".", na.strings="", col.names = c("ID","Fattening_group.Pen","t","Wt","FIt"))
#Col names
 #ID: pig identification number;
 #Fattening_group.Pen: fattening group and pen number for a given ID;
 #t :  time in days since the transfer to fattening room;
 #Wt: median weight in kg at day t for a given ID;
 #FIt: total feed intake in kg at day t for a given ID.
 
#Extract sub dataset for selected individual
 data <- subset(raw_data, ID == ID_NUMB)


#Data preparation
 data$EIt <- round(data$FIt*9.85,digits=3) # Conversion of feed intake from kg/day to MJ NE/day
 data$MRt <- round((data$Wt^0.6)*1.05*0.74,digits=3) # Calculation of maintenance requirements in MJ NE/day
 data$NEAt <- data$EIt - data$MRt # Calulation of NEA/day
 data$CNEAt <- ave(data$NEAt, data$ID, FUN=cumsum) # Calculation of cumulative NEA
 data$CWt <- data$Wt-min(data$Wt)
 
#Time series vectors  
 CNEAt<- ts(data$CNEAt[1:(length(data$CNEAt)-1)],start= 2, frequency = 1) #Cumulated net energy available - time series start at day 2 --> Intake at day t is associated to the weight at day t+1
 #Drop last day of intake --> Needs weight at t+1 to estimate allocation factor at t+1
 W <-ts(data$Wt[2:(length(data$Wt))], start = 2, frequency = 1) #Weight - Drop first day of weighing --> Needs intake at t-1 to estimate allocation factor at t
 CW <-ts(data$Wt[2:(length(data$Wt))]-min(data$Wt), start = 2, frequency = 1)#Cumulated weight gain over period - Drop first day of weighing --> Needs intake at t-1 to estimate allocation factor a t

###### DYNAMIC LINEAR MODEL (DLM) ###############
#Definition of regression model without intercept
  dlm  <- function(parm) {
  mod <-  dlmModReg(CNEAt, addInt = FALSE)
  V(mod) <- exp(parm[1])
  diag(W(mod))[1] <- exp(parm[2])
    return(mod)
  }
 
#Estimation of parameters 
  fitMyModel <-dlmMLE(W, c(0,0), build = dlm, hessian=T, debug=FALSE) # Use of weight to estimate paramaters (take into account post-weaning period)
  conv <- fitMyModel$convergence
  par <- dlm(fitMyModel$par)
  

#Smoothing
  smoothed2 <- dlmSmooth(CW, mod = par)
  Alpha <- dropFirst(smoothed2$s)

#Plotting results
  par(mfrow=c(3,1))
  plot(CW,ylab="Weight (kg)", main= paste("Cumulated weight gain of animal N#", ID_NUMB), type="l",lwd=1,  col = "green", ylim = c(0,100),  xlim = c(0,80))
  plot(CNEAt,ylab="(Energy Intake ( MJ)", main= paste("CNEA at  t-1 of animal N#", ID_NUMB), type="l",lwd=1, col = "purple", ylim = c(0,1000),  xlim = c(0,80))
  plot(Alpha,ylab="Alpha (kg / MJ)", main= paste("Alpha of animal N#", ID_NUMB), type="l",lwd=1,  col = "blue", ylim = c(0.05,0.20),  xlim = c(0,80))
  
#Export results
  
Alpha_t <-c(NA,as.numeric(round(Alpha, digits=5)))
Result <- cbind(data,Alpha_t)
write.csv(Result,"../Result.csv")
