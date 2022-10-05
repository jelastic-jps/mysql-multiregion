Multi-Region MariaDB Database cluster **${settings.envName}** successfully installed.


### Entry point details:    
**${globals.regionName-1}**: node${globals.lbID-1}-${settings.envName}-lb-1.${globals.domain-1}:3306   
**${globals.regionName-2}**: node${globals.lbID-2}-${settings.envName}-lb-2.${globals.domain-2}:3306   

### Database credentials:   
**Username**: ${globals.db_user}  
**Password**: ${globals.db_pswd}  

___

The instructions below can help you with the further managing your database cluster:

- [Connect application to the database](https://docs.jelastic.com/database-connection)
- [Share access to the environment](https://docs.jelastic.com/share-environment)
- [Adjust vertical scaling settings](https://docs.jelastic.com/automatic-vertical-scaling)
- [Monitor the statistics](https://docs.jelastic.com/view-app-statistics) & [view log files](https://docs.jelastic.com/view-log-files)
- [Access environment via SSH](https://docs.jelastic.com/ssh-access)
