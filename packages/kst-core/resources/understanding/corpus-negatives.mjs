// Separate synthetic semantic groups for unsupported and non-imperative requests.
// These lists are not substitutions of names/dates in the action training templates.
export const trainNegatives = [
 'what is the capital of Norway','explain how black holes work','why does bread rise','who invented the telescope','what caused the bronze age collapse','how many moons does Jupiter have','define entropy','compare oak and maple trees',
 'what does this poem mean','translate good morning into Japanese','write a birthday poem','tell a bedtime story','compose a song about rain','generate a company slogan','write an essay about history','summarize the plot of Hamlet',
 'solve this quadratic equation','calculate twelve times eighteen','convert miles to kilometers','what is the square root of seventy','derive the area of a circle','prove the Pythagorean theorem','calculate a mortgage payment','convert dollars into yen',
 'play some jazz music','pause the current video','turn the volume down','increase screen brightness','change my wallpaper','enable dark mode','connect my bluetooth headphones','take a screenshot',
 'send an email to Morgan','message my sister','call my dentist','post this on social media','reply to the last text','share this photo with my family','forward that document','publish my blog post',
 'delete the downloads folder','rename all these files','install a new application','update my operating system','restart the laptop','empty the trash','upload my entire drive','copy the database to a server',
 'buy a train ticket','order a pizza','book a hotel room','pay my electricity bill','transfer money to Alex','sell all my shares','place a grocery order','renew my passport online',
 'I cancelled a meeting yesterday','she added a task last week','we already completed the project','they were planning a holiday','my colleague keeps a paper calendar','I saw a reminder in another app','the terminal printed a warning','the browser was closed earlier',
 'do not delete my reminders','never schedule anything without me','dont complete that task','if I scheduled a meeting what would happen','imagine a calendar with no meetings','suppose we added a task','I am quoting someone who said cancel the meeting','could a reminder be useful for this',
 'tell me a joke about cats','what is the weather on Mars','recommend a good novel','diagnose the noise in my car','how do I grow tomatoes','teach me to juggle','predict the next election','create a three dimensional animation'
];
export const gateNegatives = [
 'which ocean is deepest','when did the printing press appear','describe how a volcano forms','why are sunsets red','how do dolphins communicate','what are the main stages of photosynthesis','explain the difference between mass and weight','where do monarch butterflies migrate',
 'rewrite this paragraph politely','make up a detective mystery','translate thank you into Arabic','write a speech for a graduation','invent a recipe with lentils','review the grammar of this sentence','create a crossword puzzle','design a logo for a bakery',
 'factor the number ninety one','integrate sine of x','calculate a fifteen percent tip','convert Celsius into Fahrenheit','how much paint covers this wall','compute the average of these numbers','what is seven factorial','calculate the odds of rolling two sixes',
 'mute the speakers','switch the wifi network','unlock the screen','close the lid for me','change the keyboard layout','start recording my screen','zoom into this photograph','turn off bluetooth',
 'text Jordan that I am late','send the attachment to the team','dial the number on this website','write a reply and email it','invite every contact to a party','make a public forum post','submit my tax forms','upload a video to my channel',
 'compress this folder','erase this external disk','move all documents to the desktop','download a large game','uninstall the browser','change my account password','disable the firewall','execute an arbitrary shell script',
 'reserve a table at a restaurant','purchase concert tickets','cancel my airline booking','pay a parking fine','bid on that auction','subscribe to a magazine','rent a car for the weekend','order flowers for delivery',
 'I finished that task before breakfast','my friend rescheduled her appointment','the book says write down your thoughts','we should discuss whether calendars help','dont run any terminal jobs','never open an external provider request','if we moved the meeting would everyone agree','suppose I asked you to clear all reminders'
];
export const testNegatives = [
 'why does the moon have phases','what are the symptoms of seasonal allergies','how are glass bottles manufactured','who wrote the oldest surviving epic','explain the rules of cricket','what makes a rainbow visible','how do electric motors rotate','why do leaves change color',
 'invent a name for my new cafe','write an opening chapter for a fantasy book','translate this menu into Italian','compose a wedding toast','make a rhyming riddle about a fox','rewrite my cover letter','draft a screenplay scene','draw a map of an imaginary island',
 'find the derivative of x squared','calculate compound interest over ten years','convert kilograms to pounds','work out the perimeter of this triangle','multiply fractions for me','solve a system of linear equations','find the median of this data','calculate my body mass index',
 'turn on the camera','reduce the display resolution','switch to the next browser window','disconnect the ethernet adapter','show my battery cycle count','change the default printer','lock my user account','start a remote desktop connection',
 'email the meeting notes to the whole team','tell my brother to call me','answer the incoming phone call','send my location to my partner','share my calendar with the public','publish the reminder list on a website','forward the latest invoice','submit an application on my behalf',
 'encrypt every document in this folder','search the drive for duplicate photos','restore a deleted database','format the memory card','download a software update','create a new administrator account','change the login keychain password','remove all saved browser cookies',
 'book an international flight','refund the concert ticket','buy a subscription to this service','open a bank account','sell my old laptop online','pay the rent from my account','place an options trade','apply for a new credit card',
 'I used to add reminders every morning','my manager cancelled the meeting without asking','the article explains how to complete a task','a story character said search the web','do not apply the proposed plan','never send that prompt to claude','imagine that I had already created the note','if a task were finished would it disappear'
];
